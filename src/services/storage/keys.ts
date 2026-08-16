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
  | "product-file"
  | "attachment"
  | "quote-document"
  | "invoice-document"
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
