import { formatBytes } from "@/lib/format-bytes";
import { ValidationError } from "@/lib/errors";
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
  /*
   * A product walkthrough. 200MB is about two or three minutes at a decent
   * bitrate — enough for a real demo, and small enough that a browser upload from
   * a phone finishes.
   *
   * `video/quicktime` is here because a `.mov` is what an iPhone produces and a
   * vendor filming their own product on a phone is the common case, not the
   * exotic one. `<video>` plays H.264 in a `.mov` container in Safari and
   * Chrome; a codec nothing can play is a problem the vendor sees immediately in
   * the preview, which is a better place to find out than a policy refusal.
   */
  "product-video": {
    maxBytes: 200 * MB,
    contentTypes: ["video/mp4", "video/webm", "video/quicktime"],
    extensions: ["mp4", "webm", "mov"],
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
  /**
   * A bank receipt or remittance advice. Small, and deliberately narrow: a
   * scan or a PDF, nothing executable, nothing archive-shaped.
   */
  "payment-proof": {
    maxBytes: 10 * MB,
    contentTypes: ["application/pdf", "image/jpeg", "image/png", "image/webp"],
    extensions: ["pdf", "jpg", "jpeg", "png", "webp"],
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
  /**
   * Vendor verification documents — vendor ticket 02.
   *
   * A passport scan or a certificate of incorporation. Narrower than
   * `payment-proof` on purpose: no `webp`, because nobody photographs an ID into
   * webp and every format allowed is a decoder somebody has to trust.
   */
  "vendor-document": {
    maxBytes: 10 * MB,
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    extensions: ["pdf", "jpg", "jpeg", "png"],
  },
  /**
   * A vendor's cover image or logo.
   *
   * **5MB, half of `product-media`.** A screenshot is evidence and wants to stay
   * legible when a customer opens it full size; a cover band is scenery behind a
   * heading, and there is no size at which 10MB of it buys anything. The lower
   * ceiling is also the only thing standing between a phone photo straight off a
   * camera roll and every storefront visitor paying for it.
   *
   * **No GIF**, unlike `product-media`. An animating cover band is a decision
   * somebody should have to make deliberately, and the way to make it
   * deliberate is to not allow it by accident. (`svg` never reaches a scope
   * list — it is in `FORBIDDEN_EXTENSIONS`, because an SVG served back is a
   * stored-XSS vector.)
   */
  "vendor-branding": {
    maxBytes: 5 * MB,
    contentTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
    extensions: ["jpg", "jpeg", "png", "webp", "avif"],
  },
  /**
   * A remittance advice — vendor ticket 09. The same set as a payment receipt, for the
   * same reason: it is a bank document, it arrives as a PDF or a photograph, and every
   * extra format allowed is another decoder somebody has to trust.
   */
  "payout-evidence": {
    maxBytes: 10 * MB,
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    extensions: ["pdf", "jpg", "jpeg", "png"],
  },
  healthcheck: { maxBytes: 1024, contentTypes: ["text/plain"], extensions: ["txt"] },
};

/**
 * A refusal, with a sentence the person who tried is meant to read.
 *
 * ## It extends `ValidationError`, and it did not
 *
 * It extended plain `Error`, so `isDomainError()` was false and `withAction` treated every storage
 * refusal as an unmodelled fault: the carefully written message was replaced with **"Something went
 * wrong on our side. Please try again. (ref E-…)"** and logged as a server error. A vendor uploading
 * a release got an incident reference instead of the reason, and the reason was sitting in the
 * error object the whole time.
 *
 * `VALIDATION` is the right code — a rejected upload is a bad input, not a server failure — and it
 * carries a 400 rather than a 500, which is also what the log should have been saying.
 *
 * The `name` is preserved deliberately: `storage.test.ts` asserts `toThrow(StoragePolicyError)`, and
 * the class identity is what the storage service's own callers catch on.
 */
export class StoragePolicyError extends ValidationError {
  constructor(message: string) {
    super(message, { file: [message] });
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

  /*
   * Video, for the `product-video` scope.
   *
   * Without these the sniff is decorative for a video: `detectContentType`
   * returns null, and `assertBytesMatchDeclared` treats unknown as "not
   * malicious" and returns early. That is the right default for a format nobody
   * enumerated — and the wrong one for the three formats we deliberately accept.
   *
   * MP4/MOV share the ISO base-media layout: a four-byte length, then `ftyp` at
   * offset 4. The brand that follows distinguishes them and is deliberately not
   * checked — `qt  `, `isom`, `mp42`, `M4V ` and a dozen others are all things a
   * vendor's camera or editor produces, and rejecting an unlisted brand would
   * refuse a perfectly playable file. WebM is Matroska's EBML header.
   */
  if (head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) {
    return "video/mp4";
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";

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

  /*
   * `application/octet-stream` is the *absence* of a declaration, not a competing one.
   *
   * Every uploader in this app sends `file.type || "application/octet-stream"`, and the file
   * uploader says why in its own comment: "an unknown type from the OS is better declared as a
   * byte stream than guessed". The browser leaves `file.type` empty for plenty of ordinary files —
   * a `.zip` from some archivers, a `.tar.gz`, anything with an extension the OS has no mapping
   * for. This function then compared "unknown" against the type it had just recognised and called
   * the difference a mismatch, so a vendor's release archive was refused for being *more*
   * identifiable than declared. The client was doing exactly what it was told and the policy
   * treated it as a lie.
   *
   * Nothing is weakened by accepting it. The executable check above is unconditional and already
   * ran; the scope's extension and content-type allowlists ran at ticket time in
   * `assertUploadAllowed`; and the case this whole function exists for — a `.exe` renamed `.zip` —
   * is caught by `EXECUTABLE_TYPES` regardless of what was declared.
   */
  if (declared === "application/octet-stream") return;
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
