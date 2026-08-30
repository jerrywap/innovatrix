import { customAlphabet } from "nanoid";

/**
 * Object-storage key construction — §44, §66, §85.
 *
 * ## Why the prefix guard exists
 *
 * The dev/staging bucket is **shared with other live applications**. A listing
 * shows prefixes belonging to unrelated products, including regulated data
 * (`kyc/`) and another app's production objects (`gracia-production/`).
 *
 * That makes key construction a security boundary, not a naming convention. A
 * traversal bug — a `..` in a filename, an id that arrives as an absolute path,
 * a template that renders `undefined` — must not be able to address another
 * application's data. Every read and write therefore passes through
 * `assertKeyInPrefix()`.
 *
 * ## Layout
 *
 * ```
 * innovatrix/{env}/
 * ├── products/{productId}/
 * │   ├── media/{nanoid}.{ext}                      ← screenshots/video, CDN-able
 * │   └── versions/{versionId}/{nanoid}-{safeName}  ← packages. NEVER public.
 * ├── vendors/{vendorId}/
 * │   ├── documents/{nanoid}-{safeName}             ← verification. NEVER public.
 * │   └── branding/{cover|logo}                     ← storefront artwork, CDN-able.
 * │                                                   Stable: a replacement overwrites.
 * ├── taxonomy/{taxonomyId}/image                   ← category card art, CDN-able.
 * │                                                   Stable, like vendor branding.
 * ├── attachments/{organizationId}/{requestId}/{nanoid}-{safeName}
 * ├── documents/quotes/{quoteId}/{nanoid}.pdf
 * ├── documents/invoices/{invoiceId}/{nanoid}.pdf
 * └── healthcheck/{nanoid}
 * ```
 *
 * The `media/` vs `versions/` split under a product is load-bearing: if a CDN
 * is ever placed in front of product media, that prefix *is* the security
 * boundary. Mixing them would let a rule exposing screenshots also expose paid
 * packages.
 *
 * The environment segment follows the convention the bucket's existing tenants
 * already use, so a development cleanup job can never reach production objects.
 */

/** URL-safe, no lookalike-ambiguous characters, no ordering information. */
const nanoid = customAlphabet(
  "0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ",
  21,
);

export class StorageKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageKeyError";
  }
}

export type StorageScope =
  | "product-media"
  /**
   * A walkthrough video on a product listing.
   *
   * Its own scope rather than a widened `product-media`, because the only thing
   * the two share is the folder they land in. A 200MB ceiling for a video is
   * reasonable; the same ceiling for a screenshot would accept a 200MB PNG.
   */
  | "product-video"
  | "product-file"
  | "attachment"
  | "payment-proof"
  | "quote-document"
  | "invoice-document"
  | "vendor-document"
  /**
   * A vendor's cover image or logo — the storefront's own artwork.
   *
   * Its own scope rather than a reused `product-media`, and the difference is
   * not the ceiling: these are the only objects we store whose key is
   * **stable**, so a replacement overwrites in place and nothing is ever
   * orphaned. A scope that also served products would have to mint a fresh key,
   * which is the behaviour this one exists to avoid.
   *
   * No GIF, unlike `product-media`: a screenshot that animates is a
   * demonstration, and a page-wide cover band that animates is a distraction
   * nobody asked for.
   */
  | "vendor-branding"
  /**
   * A category's browse-card image.
   *
   * Shares `vendor-branding`'s two properties and needs its own scope for the
   * same reason that one does: the key is **stable**, so a replacement
   * overwrites in place, and a scope that also served product media would have
   * to mint a fresh key — which is exactly the behaviour being avoided.
   *
   * Kept apart from `vendor-branding` rather than widened into it because the
   * two answer to different people. A vendor uploads their own branding; only
   * staff with `taxonomy.manage` touch this, and a shared scope would make a
   * bucket policy unable to tell them apart.
   */
  | "taxonomy-image"
  | "payout-evidence"
  | "healthcheck";

/* ────────────────────────────────────────────── prefix */

export function storageRoot(prefix: string, environment: string): string {
  return `${prefix}/${environment}`;
}

/**
 * The guard. Throws unless `key` sits strictly inside `root`.
 *
 * Rejects: traversal segments, absolute keys, backslashes, empty segments,
 * NUL bytes, and the sibling-prefix trick (`innovatrix/development-evil/…`
 * begins with `innovatrix/development` as a *string* but is a different
 * prefix — hence the trailing-separator comparison).
 */
export function assertKeyInPrefix(key: string, root: string): string {
  if (!key || typeof key !== "string") {
    throw new StorageKeyError("Storage key is empty.");
  }
  if (key.includes("\0")) {
    throw new StorageKeyError("Storage key contains a NUL byte.");
  }
  if (key.startsWith("/")) {
    throw new StorageKeyError(`Storage key must be relative, received "${key}".`);
  }
  if (key.includes("\\")) {
    throw new StorageKeyError(`Storage key must not contain backslashes, received "${key}".`);
  }

  const segments = key.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) {
    throw new StorageKeyError(`Storage key contains an unsafe path segment: "${key}".`);
  }
  // Percent-encoded traversal — decoded by some intermediaries before S3 sees it.
  if (/%2e%2e|%2f/i.test(key)) {
    throw new StorageKeyError(`Storage key contains encoded traversal: "${key}".`);
  }

  if (key !== root && !key.startsWith(`${root}/`)) {
    throw new StorageKeyError(
      `Storage key "${key}" falls outside "${root}/". The bucket is shared with ` +
        `other applications — nothing may be written or read outside our prefix.`,
    );
  }
  return key;
}

/* ────────────────────────────────────────────── filenames */

const MAX_FILENAME = 80;

/**
 * Make a customer filename safe to embed in a key.
 *
 * Note this is for *readability* of the key only — uniqueness comes from the
 * nanoid, never from the filename (§44: "Never use the customer-supplied
 * filename as the key"). The original is preserved separately for the download
 * `Content-Disposition`.
 */
export function safeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? "file";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-]+/, "")
    .slice(0, MAX_FILENAME);
  return cleaned || "file";
}

export function extensionOf(filename: string): string {
  const match = /\.([a-zA-Z0-9]{1,8})$/.exec(filename);
  return match?.[1]?.toLowerCase() ?? "bin";
}

/** RFC 5987 — keeps non-ASCII filenames intact on download without header injection. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/* ────────────────────────────────────────────── builders */

export interface KeyBuilderContext {
  root: string;
}

function id(): string {
  return nanoid();
}

/** Ids come from the database, but a template that renders `undefined` is a real bug. */
function segment(value: string, name: string): string {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new StorageKeyError(`Invalid ${name} for a storage key: "${value}".`);
  }
  return value;
}

export function productMediaKey(
  ctx: KeyBuilderContext,
  productId: string,
  filename: string,
): string {
  const key = `${ctx.root}/products/${segment(productId, "productId")}/media/${id()}.${extensionOf(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

/**
 * A video under the product's media folder, in its own `video/` sub-folder.
 *
 * Same product prefix as a screenshot, so `assertKeyBelongsTo(key, root,
 * { productId })` still answers "is this the caller's product?" without a second
 * rule. The sub-folder is for a human reading a bucket listing, not for security.
 */
export function productVideoKey(
  ctx: KeyBuilderContext,
  productId: string,
  filename: string,
): string {
  const key = `${ctx.root}/products/${segment(productId, "productId")}/media/video/${id()}.${extensionOf(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

export function productFileKey(
  ctx: KeyBuilderContext,
  productId: string,
  versionId: string,
  filename: string,
): string {
  const key =
    `${ctx.root}/products/${segment(productId, "productId")}` +
    `/versions/${segment(versionId, "versionId")}/${id()}-${safeFilename(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

export function attachmentKey(
  ctx: KeyBuilderContext,
  organizationId: string,
  subjectId: string,
  filename: string,
): string {
  const key =
    `${ctx.root}/attachments/${segment(organizationId, "organizationId")}` +
    `/${segment(subjectId, "subjectId")}/${id()}-${safeFilename(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

/**
 * Proof of an offline payment.
 *
 * Keyed by payment rather than by organisation so `assertKeyBelongsTo` has
 * something to check against, and so a leaked key cannot be walked sideways
 * into another customer's banking.
 */
export function paymentProofKey(
  ctx: KeyBuilderContext,
  paymentId: string,
  filename: string,
): string {
  const key =
    `${ctx.root}/payments/${segment(paymentId, "paymentId")}` +
    `/${id()}-${safeFilename(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

/**
 * A vendor's verification document — vendor ticket 02.
 *
 * `vendors/{vendorId}/documents/…`, deliberately its own top-level branch rather
 * than nested under anything: these objects are the most sensitive the platform
 * stores, and a prefix that is trivially greppable is a prefix an operator can
 * write a lifecycle rule against.
 */
export function vendorDocumentKey(
  ctx: KeyBuilderContext,
  vendorId: string,
  filename: string,
): string {
  const key =
    `${ctx.root}/vendors/${segment(vendorId, "vendorId")}/documents` +
    `/${id()}-${safeFilename(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

/** Which piece of a vendor's storefront artwork a key addresses. */
export type VendorBrandingKind = "cover" | "logo";

/**
 * A vendor's storefront artwork — the cover band and the logo.
 *
 * ## The key is stable, and that is the whole design
 *
 * Every other builder here mints a `nanoid()`, because every other thing they
 * name is one of many. A vendor has exactly **one** cover and exactly **one**
 * logo, so the key is derived entirely from the vendor and the kind — and a
 * replacement therefore `PUT`s over the same object rather than abandoning it.
 *
 * That matters because `s3:DeleteObject` is denied for this IAM user and
 * nothing cleans up after us: with a minted key, a vendor who tries four covers
 * leaves three objects in the bucket for ever. Freshness is handled where it
 * belongs, by `publicObjectUrl`'s `?v=` stamp.
 *
 * ## No extension
 *
 * There is nowhere to get one from — the key must be the same string before and
 * after a JPEG is replaced by a WebP, or the old object survives and the point
 * is lost. Nothing downstream needs it: S3 stores the content type from the
 * signed `PUT` and `next/image` reads the header. The *user's* filename is still
 * extension-checked, by `assertUploadAllowed`, which is a separate value.
 *
 * ## `branding/`, not `documents/`
 *
 * `vendors/{id}/documents/` holds passport scans and is the most sensitive
 * prefix in the bucket. These objects are world-readable. Two prefixes so that
 * an operator writing a bucket policy or a lifecycle rule can tell them apart
 * without reading our code.
 */
export function vendorBrandingKey(
  ctx: KeyBuilderContext,
  vendorId: string,
  kind: VendorBrandingKind,
): string {
  const key = `${ctx.root}/vendors/${segment(vendorId, "vendorId")}/branding/${kind}`;
  return assertKeyInPrefix(key, ctx.root);
}

/**
 * A category's image, at a key derived from its id.
 *
 * **Stable and extensionless**, for the reasons `vendorBrandingKey` sets out
 * above and which apply here unchanged: `s3:DeleteObject` is denied, so a minted
 * key would leave every replaced image in the bucket for ever, and there is
 * nowhere to get an extension from that would survive a JPEG being replaced by a
 * WebP. Freshness is `publicObjectUrl`'s `?v=` stamp.
 *
 * Under `taxonomy/`, not `vendors/` — these are staff-authored and world-readable,
 * and a prefix an operator can reason about is worth more than a shorter path.
 */
export function taxonomyImageKey(ctx: KeyBuilderContext, taxonomyId: string): string {
  const key = `${ctx.root}/taxonomy/${segment(taxonomyId, "taxonomyId")}/image`;
  return assertKeyInPrefix(key, ctx.root);
}

/**
 * Remittance advice for a payout — vendor ticket 09.
 *
 * Under `payouts/{payoutId}/`, not under the vendor: a payout is the thing the evidence is
 * evidence *of*, and keying by vendor would make "which transfer is this?" a search.
 */
export function payoutEvidenceKey(
  ctx: KeyBuilderContext,
  payoutId: string,
  filename: string,
): string {
  const key =
    `${ctx.root}/payouts/${segment(payoutId, "payoutId")}/evidence` +
    `/${id()}-${safeFilename(filename)}`;
  return assertKeyInPrefix(key, ctx.root);
}

export function quoteDocumentKey(ctx: KeyBuilderContext, quoteId: string): string {
  const key = `${ctx.root}/documents/quotes/${segment(quoteId, "quoteId")}/${id()}.pdf`;
  return assertKeyInPrefix(key, ctx.root);
}

export function invoiceDocumentKey(ctx: KeyBuilderContext, invoiceId: string): string {
  const key = `${ctx.root}/documents/invoices/${segment(invoiceId, "invoiceId")}/${id()}.pdf`;
  return assertKeyInPrefix(key, ctx.root);
}

export function healthcheckKey(ctx: KeyBuilderContext): string {
  return assertKeyInPrefix(`${ctx.root}/healthcheck/${id()}`, ctx.root);
}

/* ────────────────────────────────────────────── ownership */

/**
 * Prove a key belongs to *this* product, and optionally *this* version.
 *
 * `assertKeyInPrefix` answers a different question — "is this inside our
 * bucket?" — and answering only that leaves a real hole in the two-step upload
 * flow. The browser is handed a presigned URL, uploads, then calls a second
 * action to record the file. If that second action trusts the key it is given,
 * a caller can pass back a key belonging to **someone else's product** and
 * attach that object to their own: a paid package copied between products
 * without ever downloading it.
 *
 * The key layout makes the check cheap, which is the payoff of encoding
 * ownership in the path rather than only in the database.
 */
export function assertKeyBelongsTo(
  key: string,
  root: string,
  owner: { productId: string; versionId?: string },
): string {
  assertKeyInPrefix(key, root);

  const productPrefix = `${root}/products/${segment(owner.productId, "productId")}/`;
  if (!key.startsWith(productPrefix)) {
    throw new StorageKeyError(
      `That file does not belong to this product. Keys are bound to the product ` +
        `that requested them.`,
    );
  }

  if (owner.versionId) {
    const versionPrefix = `${productPrefix}versions/${segment(owner.versionId, "versionId")}/`;
    if (!key.startsWith(versionPrefix)) {
      throw new StorageKeyError("That file does not belong to this version.");
    }
  }

  return key;
}
