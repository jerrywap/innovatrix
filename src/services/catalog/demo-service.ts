import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import type { DemoCredential, ProductDoc } from "@/lib/db/models/catalog";
import type { DemoExposure } from "@/lib/db/enums";
import { NotFoundError } from "@/lib/errors";
import type { VendorScope } from "@/lib/auth/scope";
import { open, seal } from "@/lib/crypto";
import { products } from "@/repositories/product.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";

/**
 * Demo configuration and credentials — §9, §89.
 *
 * This is the first genuinely sensitive thing the platform stores, and the
 * requirement is absolute: a visitor who is not entitled to see a demo password
 * must receive a payload that **does not contain the field at all** — not a
 * blanked string, not `null`, not a hidden element.
 *
 * ## Why "hidden in the UI" is not a design here
 *
 * A React Server Component that renders `{canSee && <Password value={p} />}`
 * still serialises `p` into the RSC payload if it is in scope. The value is one
 * "view source" away. Conditional *rendering* does not imply conditional
 * *serialisation*, and that gap is the single most likely way this leaks.
 *
 * So there are two functions with two different return types, and the public
 * one **cannot** carry a credential because its type has no field for it:
 *
 * - `publicDemoView()` — safe for any caller, any cache, any payload. It
 *   reports that a credential *exists* and what role it is for, never its
 *   username or password.
 * - `revealCredentials()` — the only thing in the codebase that decrypts.
 *   Uncached, `server-only`, and it takes the viewer's status as an argument
 *   rather than reaching for it, so the authorisation is visible at the call
 *   site instead of buried here.
 *
 * The types do the work. Getting this wrong requires changing a type
 * signature, not forgetting a condition.
 */

/* ────────────────────────────────────────────── the safe view */

/** What a demo looks like to someone who may not see the credentials. */
export interface PublicDemoView {
  exposure: DemoExposure;
  publicUrl?: string;
  instructions?: string;
  /**
   * Roles only. No `username`, no `password`, and deliberately no `url` —
   * `customerUrl` and `adminUrl` are themselves part of what `owners_only`
   * withholds, since a customer-portal link is a hint worth having.
   */
  roles: Array<{ role: string; label?: string; hasPassword: boolean }>;
  /** Is there anything at all to reveal, for a viewer who qualifies? */
  hasCredentials: boolean;
}

export function publicDemoView(product: ProductDoc): PublicDemoView {
  const demo = product.demo;
  const credentials = demo?.credentials ?? [];

  // Built key by key. A spread would carry `credentials` — including
  // ciphertext, key version and IV — into whatever this is returned to.
  return {
    exposure: demo?.exposure ?? "authenticated",
    ...(demo?.publicUrl ? { publicUrl: demo.publicUrl } : {}),
    ...(demo?.instructions ? { instructions: demo.instructions } : {}),
    roles: credentials.map((credential) => ({
      role: credential.role,
      ...(credential.label ? { label: credential.label } : {}),
      hasPassword: Boolean(credential.passwordCipher?.ciphertext),
    })),
    hasCredentials: credentials.length > 0,
  };
}

/* ────────────────────────────────────────────── the gated view */

export interface RevealedCredential {
  role: string;
  label?: string;
  url?: string;
  username?: string;
  password?: string;
}

export interface DemoViewer {
  isAuthenticated: boolean;
  /** Does this viewer's organisation own the product? Ticket 14's entitlement. */
  ownsProduct: boolean;
  /** Staff see demo credentials regardless of exposure — they configure them. */
  isStaff: boolean;
  /** For the §90 audit row. Absent for an anonymous viewer of a public demo. */
  userId?: string;
  organizationId?: string;
}

/**
 * §9's exposure rule, as one pure function so it can be tested without a
 * database, a session or a request.
 */
export function canRevealCredentials(exposure: DemoExposure, viewer: DemoViewer): boolean {
  if (viewer.isStaff) return true;

  switch (exposure) {
    case "public":
      return true;
    case "authenticated":
      return viewer.isAuthenticated;
    case "owners_only":
      return viewer.ownsProduct;
    default: {
      // A new exposure value added to the enum without a rule here should deny,
      // not fall through to allow. The `never` makes it a compile error first.
      const exhaustive: never = exposure;
      void exhaustive;
      return false;
    }
  }
}

/**
 * Decrypt the demo credentials, if this viewer may see them.
 *
 * Returns `null` rather than throwing when they may not: "you are not entitled
 * to this" is an ordinary outcome on a product page, not an error, and a thrown
 * error here would take out the whole page for a case that is expected.
 *
 * **Never cache the result of this.** It is derived from who is asking.
 */
export async function revealCredentials(
  productId: string,
  viewer: DemoViewer,
): Promise<{
  credentials: RevealedCredential[];
  customerUrl?: string;
  adminUrl?: string;
} | null> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  const exposure = product.demo?.exposure ?? "authenticated";
  if (!canRevealCredentials(exposure, viewer)) return null;

  const credentials = (product.demo?.credentials ?? []).map((credential) => ({
    role: credential.role,
    ...(credential.label ? { label: credential.label } : {}),
    ...(credential.url ? { url: credential.url } : {}),
    ...(credential.username ? { username: credential.username } : {}),
    ...(credential.passwordCipher?.ciphertext
      ? { password: openPassword(credential, productId) }
      : {}),
  }));

  await recordReveal(productId, exposure, viewer, credentials);

  return {
    credentials,
    ...(product.demo?.customerUrl ? { customerUrl: product.demo.customerUrl } : {}),
    ...(product.demo?.adminUrl ? { adminUrl: product.demo.adminUrl } : {}),
  };
}

/**
 * §90's "demo credentials viewed", and the two reasons it is narrower than that.
 *
 * The service doc has referenced this audit since ticket 07 and nothing wrote
 * it. Written here rather than at the call site so it cannot be forgotten by
 * the next caller — the reveal and the record are the same operation.
 *
 * **Only when a password was actually decrypted.** A demo with a URL and no
 * credentials is a link, and logging that somebody looked at a link is noise
 * that makes the real rows harder to find.
 *
 * **Not for `public` exposure.** A public demo credential is published — it is
 * on the page for anyone, deliberately. An audit row per anonymous page view
 * would be tens of thousands of entries recording that the public read
 * something public, in an append-only collection nothing deletes. What §90
 * wants is the gated case: who, specifically, was shown a credential they had
 * to qualify for.
 */
async function recordReveal(
  productId: string,
  exposure: DemoExposure,
  viewer: DemoViewer,
  credentials: RevealedCredential[],
): Promise<void> {
  if (exposure === "public") return;
  if (!credentials.some((credential) => credential.password)) return;

  await writeAuditLog({
    action: "product.demo_credentials_viewed",
    actor: actorFor(viewer),
    subject: { type: "product", id: productId },
    ...(viewer.organizationId ? { organizationId: viewer.organizationId } : {}),
    // The roles, never the values. `redactAuditPayload` would catch a
    // `password` key anyway; not passing one is the stronger version.
    after: { exposure, roles: credentials.map((credential) => credential.role) },
  });
}

/**
 * The actor, without inventing an organisation.
 *
 * Three cases, and the middle one is the one worth naming: a *staff* viewer is
 * not a customer, and recording them as one would misattribute every reveal
 * somebody made while configuring the demo. An anonymous viewer of a gated
 * demo cannot happen — `canRevealCredentials` refused them above — so `system`
 * is unreachable in practice and is there rather than a non-null assertion.
 */
function actorFor(viewer: DemoViewer): AuditActor {
  if (!viewer.userId) return { type: "system" };
  if (viewer.isStaff) return { type: "staff", userId: viewer.userId };

  return {
    type: "customer",
    userId: viewer.userId,
    ...(viewer.organizationId ? { organizationId: viewer.organizationId } : {}),
  };
}

/**
 * A credential that will not decrypt is shown as present-but-unreadable rather
 * than taking out the page.
 *
 * This happens for one realistic reason: `ENCRYPTION_KEY` was rotated without
 * the old key being kept in `ENCRYPTION_KEYS_PREVIOUS`. That is an operational
 * mistake, and the useful behaviour is for staff to see *which* credential is
 * affected — not a 500 that says nothing about which product to fix.
 */
function openPassword(credential: DemoCredential, productId: string): string | undefined {
  if (!credential.passwordCipher) return undefined;

  try {
    // AAD is the product id, so a ciphertext copied from another product's
    // document fails to open here rather than decrypting into the wrong page.
    return open(credential.passwordCipher, productId);
  } catch {
    console.error("[demo-service] credential did not decrypt", {
      productId,
      role: credential.role,
      keyVersion: credential.passwordCipher.keyVersion,
    });
    return undefined;
  }
}

/* ────────────────────────────────────────────── writes */

export interface DemoCredentialInput {
  role: string;
  label?: string;
  url?: string;
  username?: string;
  /** Plaintext, sealed here. Empty means "keep whatever is stored". */
  password?: string;
}

export interface SaveDemoInput {
  exposure: DemoExposure;
  publicUrl?: string;
  customerUrl?: string;
  adminUrl?: string;
  instructions?: string;
  credentials: DemoCredentialInput[];
}

/**
 * Save the demo section, sealing any password that was actually typed.
 *
 * ## The blank-password rule
 *
 * The form never pre-fills a password — there is nothing to pre-fill it with
 * that would not mean sending the plaintext to the browser. So a blank field on
 * re-edit is ambiguous, and the two readings are very different: "leave it
 * alone" or "clear it". This picks **leave it alone**, matched by `role`.
 *
 * The alternative wipes every other credential's password the moment somebody
 * corrects a typo in one row's label, and does it silently — the form saves,
 * the page looks right, and the demo stops working days later.
 *
 * Clearing is therefore an explicit act: delete the row.
 */
export async function saveDemo(
  productId: string,
  input: SaveDemoInput,
  actor: AuditActor,
  /**
   * Vendor ticket 04 — present ⇒ the product must belong to this vendor.
   *
   * The credential sealing below binds each ciphertext to the **product id** as
   * AAD, so a `passwordCipher` copied between products fails to open. That already
   * stops the bytes travelling; this stops a vendor writing to a product that is
   * not theirs in the first place.
   */
  scope: VendorScope = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findScoped(productId, scope);
  // 404 for "not yours" as well as "not there" — see `saveSection`.
  if (!product) throw new NotFoundError("product", { id: productId });

  const existingByRole = new Map(
    (product.demo?.credentials ?? []).map((credential) => [
      credential.role.toLowerCase(),
      credential,
    ]),
  );

  const credentials: DemoCredential[] = input.credentials.map((row) => {
    const previous = existingByRole.get(row.role.toLowerCase());
    const cipher = row.password ? seal(row.password, productId) : previous?.passwordCipher;

    return {
      role: row.role,
      ...(row.label ? { label: row.label } : {}),
      ...(row.url ? { url: row.url } : {}),
      ...(row.username ? { username: row.username } : {}),
      ...(cipher ? { passwordCipher: cipher } : {}),
    };
  });

  // Merged into one `$set`, not spread as a second key: an object literal with
  // two `$set` properties keeps only the last, which would drop the credentials
  // and save everything else — the exact silent partial write this section can
  // least afford.
  const optional = unsetOrSet({
    "demo.publicUrl": input.publicUrl,
    "demo.customerUrl": input.customerUrl,
    "demo.adminUrl": input.adminUrl,
    "demo.instructions": input.instructions,
  });

  const saved = await products.updateById(productId, {
    $set: {
      "demo.exposure": input.exposure,
      "demo.credentials": credentials,
      ...optional.$set,
    },
    ...(optional.$unset ? { $unset: optional.$unset } : {}),
  });

  if (!saved) throw new NotFoundError("product", { id: productId });

  await writeAuditLog({
    action: "product.demo_updated",
    actor,
    subject: { type: "product", id: productId },
    // Role names and a count — never the rows. Putting `credentials` here
    // would write ciphertext, IVs and usernames into a log that is
    // deliberately permanent.
    //
    // The keys are `roles` and `rotated`, not `credentialRoles` and
    // `passwordsChanged`: `redactAuditPayload` strips any key matching
    // /password|credential|secret|.../, so the descriptive names would have
    // been logged as "[redacted]" and this row would say nothing at all. The
    // redactor is right to be blunt — the fix is to name a field for what it
    // holds, which here is a list of role names.
    after: {
      exposure: input.exposure,
      roles: credentials.map((credential) => credential.role),
      rotated: input.credentials.filter((row) => Boolean(row.password)).length,
    },
  });

  return saved;
}

/** Merge helper: `$set` ignores `undefined`, so a cleared URL needs `$unset`. */
function unsetOrSet(fields: Record<string, string | undefined>) {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) unset[key] = "";
    else set[key] = value;
  }
  return {
    ...(Object.keys(set).length > 0 ? { $set: set } : {}),
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
  };
}
