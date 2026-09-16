import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { ProductDoc } from "@/lib/db/models/catalog";
import type { CompleteOnRequestStatus } from "@/lib/db/enums";
import { NotFoundError, ValidationError } from "@/lib/errors";
import type { VendorScope } from "@/lib/auth/scope";
import { products } from "@/repositories/product.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { saveSection } from "./product-service";
import { BRAND } from "@/config/brand";

/**
 * "Complete on request" — a template vendor's offer to build the rest. COS-43.
 *
 * ## Why the moves live here rather than in a transition map
 *
 * `STATE_MACHINES` members get the terminal-state and reachability guards in
 * `states.test.ts`, which are the right guards for a lifecycle and the wrong ones
 * for a five-position flag with no ending. And the thing that actually matters
 * about these moves is **who takes them** — the vendor submits and withdraws, staff
 * decide — which a `TransitionMap` cannot express at all. `PRODUCT_TRANSITION_RULES`
 * needed a parallel rules map for exactly that reason; one file of four small
 * functions is cheaper than a second pair of maps.
 *
 * ## The approval is about the vendor, not the listing
 *
 * `PRODUCT_TRANSITIONS.published` is `["deprecated", "archived"]`, so a published
 * listing cannot be sent back through review — and re-reading the listing is not
 * what staff are doing. They are deciding whether this vendor can deliver a
 * backend. So this approval is its own thing, and approving it changes nothing
 * about the product's own status.
 *
 * ## Template-only
 *
 * A script has nothing to complete. Enforced here rather than in the schema,
 * because a Mongoose validator cannot see `catalogue` from inside the subdocument.
 */

/** The only legal moves, and who may take each. Exported for the test beside them. */
export const VENDOR_MOVES: Partial<Record<CompleteOnRequestStatus, CompleteOnRequestStatus[]>> =
  {
    // An offer that has never been sent, and one that came back refused, are the same
    // position from the vendor's side: write it, send it.
    draft: ["pending"],
    rejected: ["pending"],
    // Taking a live offer down. Not `draft`: the vendor is not editing it, they are
    // stopping it, and `withdrawn` says so on the staff queue.
    approved: ["withdrawn"],
    pending: ["withdrawn"],
    withdrawn: ["pending"],
  };

export const STAFF_MOVES: Partial<Record<CompleteOnRequestStatus, CompleteOnRequestStatus[]>> =
  {
    pending: ["approved", "rejected"],
    // Pulling a live offer, which staff can do without the vendor's involvement —
    // the same power `listingSuppressed` gives them over a whole listing.
    approved: ["withdrawn"],
  };

export function assertMove(
  from: CompleteOnRequestStatus | undefined,
  to: CompleteOnRequestStatus,
  by: "vendor" | "staff",
): void {
  const current = from ?? "draft";
  const allowed = (by === "vendor" ? VENDOR_MOVES : STAFF_MOVES)[current] ?? [];

  if (!allowed.includes(to)) {
    throw new ValidationError(`This offer cannot go from ${current} to ${to}.`, {
      status: [`No ${by} move exists from ${current} to ${to}.`],
    });
  }
}

/** Absent means never offered, which is `draft` for every purpose here. */
export function offerStatus(product: ProductDoc): CompleteOnRequestStatus {
  return product.completeOnRequest?.status ?? "draft";
}

/** The one question every public surface asks. */
export function offerIsLive(product: {
  catalogue?: string;
  completeOnRequest?: { status?: string };
}): boolean {
  return product.catalogue === "template" && product.completeOnRequest?.status === "approved";
}

async function load(productId: string, scope: VendorScope): Promise<ProductDoc> {
  await connectToDatabase();
  const product = await products.findScoped(productId, scope);
  if (!product) throw new NotFoundError("product", { id: productId });
  return product;
}

/**
 * The vendor sends the offer to staff.
 *
 * Refuses a script, and refuses an offer with nothing in it: staff are being asked
 * to judge whether this vendor can deliver, and "yes I can" with no scope and no
 * lead time gives them nothing to judge.
 */
export async function submitOffer(
  input: { productId: string; scope: VendorScope },
  actor: AuditActor,
): Promise<void> {
  const product = await load(input.productId, input.scope);

  if (product.catalogue !== "template") {
    throw new ValidationError(
      "Only a website template can offer to be completed — a full script already is.",
      { catalogue: ["This listing is not a template."] },
    );
  }

  const offer = product.completeOnRequest;
  if (!offer?.scope?.trim()) {
    throw new ValidationError("Say what you would build, so we can judge it.", {
      scope: ["Describe what the complete version would add."],
    });
  }

  assertMove(offerStatus(product), "pending", "vendor");

  await saveSection(
    input.productId,
    "complete_on_request",
    {
      "completeOnRequest.status": "pending",
      "completeOnRequest.requestedAt": new Date(),
      // A resubmission clears the last refusal, so a stale reason cannot sit under
      // a live offer.
      "completeOnRequest.note": undefined,
      "completeOnRequest.decidedAt": undefined,
      "completeOnRequest.decidedByUserId": undefined,
    },
    actor,
    input.scope,
  );

  await writeAuditLog({
    action: "product.complete_on_request_submitted",
    actor,
    subject: { type: "product", id: input.productId },
    after: { leadTime: offer.leadTime ?? null },
  });
}

/**
 * Staff decide.
 *
 * A refusal **requires** a note, for the reason every other refusal in this
 * codebase does: the vendor reads it verbatim and "rejected" on its own is not
 * something anybody can act on.
 */
export async function decideOffer(
  input: {
    productId: string;
    outcome: "approved" | "rejected";
    note?: string;
    decidedByUserId: string;
  },
  actor: AuditActor,
): Promise<void> {
  const product = await load(input.productId, {});

  if (input.outcome === "rejected" && !input.note?.trim()) {
    throw new ValidationError("Say why — the vendor reads this.", {
      note: ["A reason is required to refuse an offer."],
    });
  }

  assertMove(offerStatus(product), input.outcome, "staff");

  await saveSection(
    input.productId,
    "complete_on_request",
    {
      "completeOnRequest.status": input.outcome,
      "completeOnRequest.decidedAt": new Date(),
      "completeOnRequest.decidedByUserId": toObjectId(input.decidedByUserId),
      "completeOnRequest.note": input.note?.trim() || undefined,
    },
    actor,
  );

  await writeAuditLog({
    action: "product.complete_on_request_decided",
    actor,
    subject: { type: "product", id: input.productId },
    after: { outcome: input.outcome },
  });
}

/**
 * Take the offer down.
 *
 * Called by the vendor, by staff, and by `template-sibling.ts` once the script
 * exists — at which point the offer is not merely stale but wrong, because the
 * template would otherwise appear in `/marketplace` twice: once advertising work,
 * and once as the product that work produced.
 *
 * `scope` is optional so the sibling path can call it as the system.
 */
export async function withdrawOffer(
  input: { productId: string; scope?: VendorScope; by: "vendor" | "staff" },
  actor: AuditActor,
): Promise<void> {
  const product = await load(input.productId, input.scope ?? {});

  // Nothing to take down. Not an error: the sibling path calls this for every
  // template, and most have never made an offer.
  const current = offerStatus(product);
  if (!product.completeOnRequest || current === "withdrawn") return;

  assertMove(current, "withdrawn", input.by);

  await saveSection(
    input.productId,
    "complete_on_request",
    { "completeOnRequest.status": "withdrawn" },
    actor,
    input.scope,
  );

  await writeAuditLog({
    action: "product.complete_on_request_withdrawn",
    actor,
    subject: { type: "product", id: input.productId },
    after: { from: current },
  });
}

/* ────────────────────────────────────────────── the staff queue */

export interface OfferRow {
  id: string;
  name: string;
  slug: string;
  vendorName: string;
  status: CompleteOnRequestStatus;
  scope?: string;
  leadTime?: string;
  requestedAt?: Date;
}

/**
 * Offers waiting on a decision, oldest first.
 *
 * The ordering is the same decision `listSubmissions` made and for the same reason:
 * a vendor waiting is a vendor whose offer earns nothing, and any cleverer order is
 * a way of letting somebody wait indefinitely.
 *
 * `pending` only. An approved or refused offer is visible on the product itself, and
 * a queue that lists settled work is a queue people stop reading.
 */
export async function listPendingOffers(limit = 100): Promise<OfferRow[]> {
  await connectToDatabase();

  const page = await products.list({
    filter: { "completeOnRequest.status": "pending" },
    sort: { "completeOnRequest.requestedAt": 1 },
    limit: Math.min(limit, 200),
  });

  return page.items.map((product) => ({
    id: String(product._id),
    name: product.name,
    slug: product.slug,
    vendorName: product.vendorName ?? BRAND.name,
    status: product.completeOnRequest?.status ?? "draft",
    ...(product.completeOnRequest?.scope ? { scope: product.completeOnRequest.scope } : {}),
    ...(product.completeOnRequest?.leadTime
      ? { leadTime: product.completeOnRequest.leadTime }
      : {}),
    ...(product.completeOnRequest?.requestedAt
      ? { requestedAt: product.completeOnRequest.requestedAt }
      : {}),
  }));
}
