import { formatBytes } from "@/lib/format-bytes";
import type { StorageScope } from "./keys";

/**
 * Upload policy — what may be stored, by scope (§88 "secure file handling").
 *
 * Two independent checks, because either alone is bypassable:
 *   1. **Declared** content type — allowlisted here, and enforced by the
 *      presigned POST policy so S3 itself rejects a mismatch.
 *   2. **Actual** bytes — magic-number sniffing in `detectContentType()`, run
 *      server-side before a file document is persisted. A `.exe` renamed to
 *      `.zip` passes (1) and fails (2).
 */

export interface ScopePolicy {
  readonly maxBytes: number;
  readonly contentTypes: readonly string[];
  readonly extensions: readonly string[];
}

const MB = 1024 * 1024;
const GB = 1024 * MB;

export const STORAGE_POLICY: Record<StorageScope, ScopePolicy> = {
  "product-media": {
    maxBytes: 10 * MB,
    contentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"],
    extensions: ["jpg", "jpeg", "png", "webp", "avif", "gif"],
  },
  // Whole applications: a Laravel monolith with vendor/ and a database dump is
  // routinely hundreds of megabytes (§44).
  "product-file": {
    maxBytes: 2 * GB,
    contentTypes: [
      "application/zip",
      "application/x-zip-compressed",
      "application/gzip",
      "application/x-tar",
      "application/pdf",
      "application/sql",
      "text/plain",
      "text/markdown",
      "application/octet-stream",
    ],
    extensions: ["zip", "gz", "tgz", "tar", "pdf", "sql", "md", "txt"],
  },
  attachment: {
    maxBytes: 25 * MB,
    contentTypes: [
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/csv",
      "text/plain",
    ],
    extensions: ["jpg", "jpeg", "png", "webp", "pdf", "docx", "xlsx", "csv", "txt"],
  },
  "quote-document": {
    maxBytes: 20 * MB,
    contentTypes: ["application/pdf"],
    extensions: ["pdf"],
  },
  "invoice-document": {
    maxBytes: 20 * MB,
    contentTypes: ["application/pdf"],
    extensions: ["pdf"],
  },
  healthcheck: { maxBytes: 1024, contentTypes: ["text/plain"], extensions: ["txt"] },
};

export class StoragePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StoragePolicyError";
  }
}

/**
 * Extensions that must never be stored regardless of scope or declared type.
 * `application/octet-stream` is legitimately needed for product packages, so
 * the extension list is the backstop that keeps executables out.
 */
const FORBIDDEN_EXTENSIONS = new Set([
  "exe",
  "dll",
  "so",
  "dylib",
  "bat",
  "cmd",
  "com",
  "scr",
  "msi",
  "app",
  "sh",
  "bash",
  "ps1",
  "vbs",
  "js",
  "mjs",
  "jar",
  "apk",
  "deb",
  "rpm",
  "php",
  "phtml",
  "asp",
  "aspx",
  "jsp",
  "cgi",
  "pl",
  "py",
  "rb",
  "html",
  "htm",
  "svg", // stored-XSS vectors when served back
]);

export function assertUploadAllowed(input: {
  scope: StorageScope;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): ScopePolicy {
  const policy = STORAGE_POLICY[input.scope];
  if (!policy) {
    throw new StoragePolicyError(`Unknown storage scope "${input.scope}".`);
  }

  const ext = (/\.([a-zA-Z0-9]{1,8})$/.exec(input.filename)?.[1] ?? "").toLowerCase();

  if (FORBIDDEN_EXTENSIONS.has(ext)) {
    throw new StoragePolicyError(`Files of type .${ext} cannot be uploaded.`);
  }
  // Double extension: shell.php.zip
  const parts = input.filename.toLowerCase().split(".");
  if (parts.slice(1, -1).some((p) => FORBIDDEN_EXTENSIONS.has(p))) {
    throw new StoragePolicyError(`"${input.filename}" has a disallowed double extension.`);
  }

  if (!policy.extensions.includes(ext)) {
    throw new StoragePolicyError(
      `.${ext || "(none)"} isn’t accepted here. Allowed: ${policy.extensions.map((e) => `.${e}`).join(", ")}.`,
    );
  }

  const declared = input.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!policy.contentTypes.includes(declared)) {
    throw new StoragePolicyError(`Content type "${declared}" isn’t accepted for this upload.`);
  }

  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new StoragePolicyError("File size must be a positive whole number of bytes.");
  }
  if (input.sizeBytes > policy.maxBytes) {
    throw new StoragePolicyError(
      `That file is ${formatBytes(input.sizeBytes)}. The limit here is ${formatBytes(policy.maxBytes)}.`,
    );
  }

  return policy;
}

/**
 * Magic-number sniffing. Returns the detected type, or null when the leading
 * bytes match nothing known.
 *
 * Deliberately small: this exists to catch an executable wearing a `.zip`
 * extension, not to be a full content-type database. Ticket 26 may swap in a
 * dedicated library.
 */
export function detectContentType(head: Uint8Array): string | null {
  const starts = (...bytes: number[]) => bytes.every((b, i) => head[i] === b);

  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (starts(0x25, 0x50, 0x44, 0x46)) return "application/pdf";
  if (starts(0x1f, 0x8b)) return "application/gzip";
  // ZIP — also docx/xlsx, which are zip containers.
  if (starts(0x50, 0x4b) && (head[2] === 0x03 || head[2] === 0x05 || head[2] === 0x07)) {
    return "application/zip";
  }
  if (starts(0x52, 0x49, 0x46, 0x46) && head[8] === 0x57) return "image/webp";

  // Executables — the cases this function exists for.
  if (starts(0x4d, 0x5a)) return "application/x-msdownload"; // PE/EXE
  if (starts(0x7f, 0x45, 0x4c, 0x46)) return "application/x-executable"; // ELF
  if (starts(0xcf, 0xfa, 0xed, 0xfe) || starts(0xfe, 0xed, 0xfa, 0xcf)) {
    return "application/x-mach-binary";
  }
  if (starts(0x23, 0x21)) return "text/x-shellscript"; // #!

  return null;
}

const EXECUTABLE_TYPES = new Set([
  "application/x-msdownload",
  "application/x-executable",
  "application/x-mach-binary",
  "text/x-shellscript",
]);

export function assertBytesMatchDeclared(head: Uint8Array, declaredContentType: string): void {
  const detected = detectContentType(head);
  if (!detected) return; // unknown ≠ malicious; the extension allowlist already ran

  if (EXECUTABLE_TYPES.has(detected)) {
    throw new StoragePolicyError("That file is an executable and cannot be uploaded.");
  }

  const declared = declaredContentType.split(";")[0]?.trim().toLowerCase() ?? "";
  // docx/xlsx are zip containers; treat the family as equivalent.
  const zipFamily = ["application/zip", "application/x-zip-compressed"];
  const isZipish =
    zipFamily.includes(detected) &&
    (zipFamily.includes(declared) || declared.startsWith("application/vnd.openxmlformats"));

  if (detected !== declared && !isZipish) {
    throw new StoragePolicyError(
      `File contents don’t match the declared type (looks like ${detected}, declared ${declared}).`,
    );
  }
}

/** Re-exported so callers of the policy don't need a second import. */
export { formatBytes };
