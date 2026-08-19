import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { withTransaction } from "@/lib/db/transaction";
import { Product, type ProductDoc } from "@/lib/db/models/catalog";
import { Entitlement } from "@/lib/db/models/commerce";
import { LedgerEntry } from "@/lib/db/models/ledger";
import { Vendor, type VendorDoc } from "@/lib/db/models/vendors";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { emit } from "@/lib/events";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import * as vendorService from "./vendor-service";

/**
 * Suspension, offboarding and emergency delisting — vendor ticket 12.
 *
 * This is the half of the ticket that had to be settled before the first vendor was onboarded,
 * because getting it wrong is discovered at the worst possible moment. The promise it keeps:
 *
 * > **A customer who bought never loses what they bought.**
 *
 * Their entitlement stays active, their licence stays valid, and their downloads keep working —
 * through suspension, through offboarding, and even through an emergency delist (where the
 * entitlement is *suspended*, not revoked, because somebody who paid for something later found
 * to be stolen is owed a refund conversation rather than a silent lockout).
 *
 * That promise is only keepable because vendor ticket 06 mirrors every artefact into our own
 * bucket. A delivery model that redirected to the vendor's server could not make it, which is
 * the strongest argument for the one that was chosen.
 *
 * ## Unlisting is not unpublishing
 *
 * A suspended vendor's products keep `status: "published"`, their URLs and their reviews, and
 * gain `listingSuppressed: true`. The marketplace pipeline excludes them and checkout refuses
 * them; reinstating is one flag flip rather than a rebuild. Moving them to `draft` would lose
 * the publish date, break every inbound link, and make reinstatement a re-approval.
 */

/* ────────────────────────────────────────────── suspension */

export async function suspend(
  vendorId: string,
  reason: string,
  actor: AuditActor,
): Promise<{ vendor: VendorDoc; productSlugs: string[] }> {
  if (!reason.trim()) {
    throw new ValidationError("A suspension needs a reason the vendor can read.", {
      reason: ["Say why, in a sentence they will see."],
    });
  }

  // The status move, its audit row and the `VendorSuspended` event all live in
  // `vendorService.transition` — this adds what suspension *means* to the catalogue.
  const vendor = await vendorService.transition(vendorId, "suspended", actor, {
    reason: reason.trim(),
  });

  const { modifiedCount, slugs } = await setListingSuppressed(vendorId, true);

  await writeAuditLog({
    action: "vendor.products_unlisted",
    actor,
    subject: { type: "vendor", id: vendorId },
    after: { products: modifiedCount, reason: reason.trim() },
  });

  return { vendor, productSlugs: slugs };
}

/**
 * Back on sale.
 *
 * The URLs, the reviews and the publish dates are all still there, because nothing was
 * unpublished — so this is a flag flip and a cache dump rather than a re-approval.
 */
export async function reinstate(
  vendorId: string,
  actor: AuditActor,
): Promise<{ vendor: VendorDoc; productSlugs: string[] }> {
  const vendor = await vendorService.transition(vendorId, "verified", actor);

  const { modifiedCount, slugs } = await setListingSuppressed(vendorId, false);

  await writeAuditLog({
    action: "vendor.products_relisted",
    actor,
    subject: { type: "vendor", id: vendorId },
    after: { products: modifiedCount },
  });

  return { vendor, productSlugs: slugs };
}

/* ────────────────────────────────────────────── offboarding */

export interface OffboardOutcome {
  vendor: VendorDoc;
  productsUnlisted: number;
  /** Entitlements that stay active — reported so the number is visible, not so it changes. */
  entitlementsPreserved: number;
  /** Cleared money still owed at the moment of offboarding. */
  outstanding: Array<{ currency: string; amount: number }>;
  /** For the caller's cache invalidation — see the module comment. */
  productSlugs: string[];
}

/**
 * End the relationship without harming a customer.
 *
 * What ends: new sales, the storefront, and the vendor's access to sell. What continues:
 * entitlements, downloads, licence validity, and the support obligation — which transfers to
 * platform staff (vendor ticket 13).
 *
 * ## The ledger is closed, not deleted
 *
 * `closedAt` on the vendor, and **every entry stays**. §90's append-only discipline covers the
 * ledger for the reason it covers the audit log: a vendor relationship that ended in a dispute
 * is one whose records get read later. What is *reported* here is the outstanding cleared
 * balance, because final settlement is a payout somebody has to run — this refuses to pretend
 * it has run one.
 *
 * Refusing when money is owed would be worse than reporting it: a vendor we cannot offboard
 * because of £4 is a vendor still selling.
 */
export async function offboard(
  vendorId: string,
  reason: string,
  actor: AuditActor,
): Promise<OffboardOutcome> {
  await connectToDatabase();

  if (!reason.trim()) {
    throw new ValidationError("Say why this vendor is being offboarded.", {
      reason: ["It goes in the audit row and somebody will read it in a year."],
    });
  }

  const vendor = await vendorService.transition(vendorId, "offboarded", actor, {
    reason: reason.trim(),
  });

  const { modifiedCount, slugs, productIds } = await setListingSuppressed(vendorId, true);

  // Deliberately **not** touched: `Entitlement.status`, `Licence.status`, or any download
  // permission. The count is read so the audit row can state what survived — a number nobody
  // recorded is a promise nobody can check.
  const entitlementsPreserved = await Entitlement.countDocuments({
    productId: { $in: productIds.map((id) => toObjectId(String(id))) },
    status: "active",
  });

  const outstanding = await outstandingBalance(vendorId);

  await Vendor.updateOne({ _id: toObjectId(vendorId) }, { $set: { closedAt: new Date() } });

  await writeAuditLog({
    action: "vendor.offboarded",
    actor,
    subject: { type: "vendor", id: vendorId },
    after: {
      reason: reason.trim(),
      productsUnlisted: modifiedCount,
      entitlementsPreserved,
      outstanding,
    },
  });

  // Told, not left to find out. A customer who discovers their vendor is gone by needing help
  // discovers it at the worst moment, and the notification says what survives rather than only
  // what ended.
  await emit("VendorOffboarded", {
    vendorId,
    displayName: vendor.displayName,
    productIds: productIds.map(String),
  });

  return {
    vendor,
    productsUnlisted: modifiedCount,
    entitlementsPreserved,
    outstanding,
    productSlugs: slugs,
  };
}

/* ────────────────────────────────────────────── emergency delisting */

/**
 * One product, off the marketplace now.
 *
 * Ahead of any process, with the process following — a product found to be malicious or
 * infringing must stop being sold in one action, and a workflow that requires three approvals
 * first is a workflow nobody uses in the emergency it was designed for.
 *
 * **Entitlements are suspended, not revoked.** Somebody who paid for something later found to be
 * stolen is owed a refund conversation, and revoking silently would take away both the software
 * and the record that they had it. `processPaymentRefunded` takes exactly the same position for
 * exactly the same reason.
 *
 * The product goes to `archived` rather than being flagged: this is not "the seller is
 * suspended", it is "this thing must not be sold again", and reinstating it should be a
 * deliberate re-publication rather than a flag flip.
 */
export async function emergencyDelist(
  productId: string,
  reason: string,
  actor: AuditActor,
): Promise<{
  product: ProductDoc;
  entitlementsSuspended: number;
  productSlug: string;
  vendorSlug?: string;
}> {
  await connectToDatabase();

  if (!reason.trim()) {
    throw new ValidationError("An emergency delisting needs a reason on the record.", {
      reason: ["What was found, and how."],
    });
  }

  const before = await Product.findById(toObjectId(productId)).lean<ProductDoc>();
  if (!before) throw new NotFoundError("product", { id: productId });

  const write = async (session?: ClientSession) => {
    const updated = await Product.findOneAndUpdate(
      { _id: toObjectId(productId) },
      { $set: { status: "archived", listingSuppressed: true, delistedReason: reason.trim() } },
      { returnDocument: "after", ...(session ? { session } : {}) },
    ).lean<ProductDoc>();

    if (!updated) throw new NotFoundError("product", { id: productId });

    const suspended = await Entitlement.updateMany(
      { productId: toObjectId(productId), status: "active" },
      { $set: { status: "suspended" } },
      session ? { session } : {},
    );

    await writeAuditLog(
      {
        action: "product.emergency_delisted",
        actor,
        subject: { type: "product", id: productId },
        before: { status: before.status },
        after: {
          status: "archived",
          reason: reason.trim(),
          entitlementsSuspended: suspended.modifiedCount ?? 0,
        },
      },
      session,
    );

    return { product: updated, entitlementsSuspended: suspended.modifiedCount ?? 0 };
  };

  const result = supportsTransactions() ? await withTransaction(write) : await write();

  await emit("ProductEmergencyDelisted", {
    productId,
    productName: before.name,
    ...(before.vendorId ? { vendorId: String(before.vendorId) } : {}),
    reason: reason.trim(),
  });

  return {
    ...result,
    productSlug: before.slug,
    ...(before.vendorSlug ? { vendorSlug: before.vendorSlug } : {}),
  };
}

/* ────────────────────────────────────────────── internals */

/**
 * Flip the listing flag across a vendor's products.
 *
 * One `updateMany` rather than a loop, and it returns the slugs because the cache is keyed by
 * slug — invalidating the whole catalogue *and* each product page is what makes "within the
 * cache window" actually mean "immediately".
 *
 * `status: "published"` is in the filter on the way *out* only. On the way back in it is not:
 * a product that was published when the vendor was suspended is the only kind that could have
 * been suppressed, so relisting can safely clear the flag wherever it is set.
 */
async function setListingSuppressed(
  vendorId: string,
  suppressed: boolean,
): Promise<{
  modifiedCount: number;
  slugs: string[];
  productIds: import("mongoose").Types.ObjectId[];
}> {
  await connectToDatabase();

  const affected = await Product.find(
    suppressed
      ? { vendorId: toObjectId(vendorId), status: "published" as const }
      : { vendorId: toObjectId(vendorId), listingSuppressed: true },
  )
    .select({ slug: 1 })
    .lean<Array<{ _id: import("mongoose").Types.ObjectId; slug: string }>>();

  if (affected.length === 0) return { modifiedCount: 0, slugs: [], productIds: [] };

  const result = await Product.updateMany(
    { _id: { $in: affected.map((row) => row._id) } as never },
    suppressed ? { $set: { listingSuppressed: true } } : { $unset: { listingSuppressed: "" } },
  );

  return {
    modifiedCount: result.modifiedCount ?? 0,
    slugs: affected.map((row) => row.slug),
    productIds: affected.map((row) => row._id),
  };
}

/** Cleared money still owed, per currency. Never summed across currencies. */
async function outstandingBalance(
  vendorId: string,
): Promise<Array<{ currency: string; amount: number }>> {
  const rows = await LedgerEntry.aggregate<{ _id: string; total: number }>([
    { $match: { vendorId: toObjectId(vendorId), status: { $in: ["pending", "cleared"] } } },
    { $group: { _id: "$amount.currency", total: { $sum: "$amount.amount" } } },
  ]);

  return rows
    .filter((row) => row.total !== 0)
    .map((row) => ({ currency: row._id, amount: row.total }));
}
