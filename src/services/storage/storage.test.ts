import { describe, expect, it } from "vitest";
import {
  StorageKeyError,
  assertKeyBelongsTo,
  assertKeyInPrefix,
  attachmentKey,
  contentDisposition,
  extensionOf,
  healthcheckKey,
  invoiceDocumentKey,
  productFileKey,
  productMediaKey,
  quoteDocumentKey,
  safeFilename,
  storageRoot,
} from "./keys";
import {
  STORAGE_POLICY,
  StoragePolicyError,
  assertBytesMatchDeclared,
  assertUploadAllowed,
  detectContentType,
  formatBytes,
} from "./policy";

const ROOT = storageRoot("innovatrix", "development");
const ctx = { root: ROOT };
const OID = "652f1a2b3c4d5e6f70819200";

/* ────────────────────────────────────────────── the prefix guard */

describe("assertKeyInPrefix — the shared-bucket containment boundary", () => {
  it("accepts a key inside our prefix", () => {
    expect(assertKeyInPrefix(`${ROOT}/products/x/media/abc.png`, ROOT)).toBeTruthy();
  });

  /**
   * The bucket holds other applications' live data, including `kyc/` and
   * `gracia-production/`. Each of these is a route to it.
   */
  it.each([
    ["parent traversal", `${ROOT}/../gracia-production/secret.json`],
    ["deep traversal", `${ROOT}/products/../../../kyc/passport.jpg`],
    ["absolute key", "/kyc/passport.jpg"],
    ["another tenant outright", "gracia-production/db.sql"],
    ["backslash traversal", `${ROOT}\\..\\kyc`],
    ["encoded traversal", `${ROOT}/%2e%2e/kyc/passport.jpg`],
    ["encoded slash", `${ROOT}/a%2Fb`],
    ["current-dir segment", `${ROOT}/./products/x`],
    ["empty segment", `${ROOT}//products`],
    ["NUL byte", `${ROOT}/a\0b`],
    ["empty key", ""],
  ])("rejects %s", (_label, key) => {
    expect(() => assertKeyInPrefix(key, ROOT)).toThrow(StorageKeyError);
  });

  /**
   * The subtle one: `innovatrix/development-evil/…` passes a naive
   * `startsWith(root)` because the root is a string prefix of it, but it is a
   * different namespace entirely.
   */
  it("rejects a sibling prefix that merely starts with the same string", () => {
    expect(() => assertKeyInPrefix("innovatrix/development-evil/x", ROOT)).toThrow(
      StorageKeyError,
    );
    expect(() => assertKeyInPrefix("innovatrix/developmentX/x", ROOT)).toThrow(StorageKeyError);
  });

  it("separates environments so a dev sweep cannot touch production", () => {
    const dev = storageRoot("innovatrix", "development");
    const prod = storageRoot("innovatrix", "production");
    expect(dev).not.toBe(prod);
    expect(() => assertKeyInPrefix(`${prod}/products/x/media/a.png`, dev)).toThrow(
      StorageKeyError,
    );
  });
});

/* ────────────────────────────────────────────── key builders */

describe("key builders", () => {
  it("puts product media and product packages under different prefixes", () => {
    const media = productMediaKey(ctx, OID, "screenshot.png");
    const pkg = productFileKey(ctx, OID, OID, "crm-pro-2.4.1.zip");

    expect(media).toMatch(new RegExp(`^${ROOT}/products/${OID}/media/[\\w-]{21}\\.png$`));
    expect(pkg).toMatch(
      new RegExp(`^${ROOT}/products/${OID}/versions/${OID}/[\\w-]{21}-crm-pro-2.4.1.zip$`),
    );
    // The boundary a CDN rule would key on.
    expect(media.startsWith(`${ROOT}/products/${OID}/media/`)).toBe(true);
    expect(pkg.startsWith(`${ROOT}/products/${OID}/media/`)).toBe(false);
  });

  it("never derives uniqueness from the customer's filename", () => {
    const a = productMediaKey(ctx, OID, "same.png");
    const b = productMediaKey(ctx, OID, "same.png");
    expect(a).not.toBe(b);
  });

  it("builds attachment, quote and invoice keys under our prefix", () => {
    for (const key of [
      attachmentKey(ctx, OID, OID, "spec.pdf"),
      quoteDocumentKey(ctx, OID),
      invoiceDocumentKey(ctx, OID),
      healthcheckKey(ctx),
    ]) {
      expect(key.startsWith(`${ROOT}/`)).toBe(true);
    }
  });

  it("refuses an id that would render as a path or as undefined", () => {
    expect(() => productMediaKey(ctx, "../../kyc", "a.png")).toThrow(StorageKeyError);
    expect(() => productMediaKey(ctx, "", "a.png")).toThrow(StorageKeyError);
    expect(() => productMediaKey(ctx, "undefined/x", "a.png")).toThrow(StorageKeyError);
  });
});

/* ────────────────────────────────────────────── ownership */

describe("assertKeyBelongsTo — the two-step upload's missing check", () => {
  const OTHER = "652f1a2b3c4d5e6f70819299";

  /**
   * The hole this closes. The browser uploads to a presigned URL, then calls a
   * second action to record the file. `assertKeyInPrefix` proves the key is in
   * our bucket — it says nothing about *whose* product it belongs to. Without
   * this check, a caller can hand back a key belonging to another product and
   * attach that object to their own: a paid package copied between products
   * without ever downloading it.
   */
  it("rejects a key belonging to another product", () => {
    const theirs = productFileKey(ctx, OTHER, OID, "crm.zip");
    expect(() => assertKeyBelongsTo(theirs, ROOT, { productId: OID })).toThrow(StorageKeyError);
  });

  it("rejects a key from another version of the same product", () => {
    const otherVersion = productFileKey(ctx, OID, OTHER, "crm.zip");
    expect(() =>
      assertKeyBelongsTo(otherVersion, ROOT, { productId: OID, versionId: OID }),
    ).toThrow(/does not belong to this version/);
  });

  it("accepts the key it issued", () => {
    const mine = productFileKey(ctx, OID, OID, "crm.zip");
    expect(assertKeyBelongsTo(mine, ROOT, { productId: OID, versionId: OID })).toBe(mine);
  });

  it("accepts product media when only the product is named", () => {
    const media = productMediaKey(ctx, OID, "shot.png");
    expect(assertKeyBelongsTo(media, ROOT, { productId: OID })).toBe(media);
  });

  it("still refuses anything outside our prefix", () => {
    expect(() =>
      assertKeyBelongsTo("gracia-production/db.sql", ROOT, { productId: OID }),
    ).toThrow(StorageKeyError);
  });

  it("refuses a product id that would render as a path", () => {
    const mine = productFileKey(ctx, OID, OID, "crm.zip");
    expect(() => assertKeyBelongsTo(mine, ROOT, { productId: "../../kyc" })).toThrow(
      StorageKeyError,
    );
  });
});

describe("filename handling", () => {
  it("strips directory components a browser might send", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\me\\report.pdf")).toBe("report.pdf");
  });

  it("keeps names readable without letting them affect the path", () => {
    expect(safeFilename("Q3 Report (final).pdf")).toBe("Q3-Report-final.pdf");
    expect(safeFilename("....")).toBe("file");
    expect(safeFilename("")).toBe("file");
  });

  it("reads extensions case-insensitively", () => {
    expect(extensionOf("A.PNG")).toBe("png");
    expect(extensionOf("noextension")).toBe("bin");
  });

  it("emits an RFC 5987 disposition that survives non-ASCII and resists injection", () => {
    expect(contentDisposition("rapport-café.pdf")).toBe(
      `attachment; filename="rapport-caf_.pdf"; filename*=UTF-8''rapport-caf%C3%A9.pdf`,
    );
    // A quote or CRLF must not break out of the header value.
    const nasty = contentDisposition('a".pdf');
    expect(nasty).not.toContain('a".pdf');
    expect(contentDisposition("a\r\nX-Evil: 1.pdf")).not.toMatch(/[\r\n]/);
  });
});

/* ────────────────────────────────────────────── policy */

describe("upload policy", () => {
  const ok = {
    scope: "product-media" as const,
    filename: "shot.png",
    contentType: "image/png",
    sizeBytes: 1024,
  };

  it("accepts a legitimate upload and returns the scope's cap", () => {
    expect(assertUploadAllowed(ok).maxBytes).toBe(STORAGE_POLICY["product-media"].maxBytes);
  });

  it("rejects an executable however it is dressed up", () => {
    expect(() => assertUploadAllowed({ ...ok, filename: "setup.exe" })).toThrow(
      StoragePolicyError,
    );
    // Double extension
    expect(() =>
      assertUploadAllowed({
        ...ok,
        scope: "product-file",
        filename: "shell.php.zip",
        contentType: "application/zip",
      }),
    ).toThrow(/double extension/);
  });

  it("rejects SVG and HTML as media — stored-XSS vectors", () => {
    expect(() =>
      assertUploadAllowed({ ...ok, filename: "logo.svg", contentType: "image/svg+xml" }),
    ).toThrow(StoragePolicyError);
  });

  it("enforces the per-scope size cap with a message a customer can act on", () => {
    expect(() => assertUploadAllowed({ ...ok, sizeBytes: 11 * 1024 * 1024 })).toThrow(/10MB/);
  });

  it("rejects a content type outside the scope's allowlist", () => {
    expect(() =>
      assertUploadAllowed({ ...ok, filename: "a.pdf", contentType: "application/pdf" }),
    ).toThrow(StoragePolicyError);
  });

  it("allows a 2GB product package where media would be refused", () => {
    expect(() =>
      assertUploadAllowed({
        scope: "product-file",
        filename: "crm.zip",
        contentType: "application/zip",
        sizeBytes: 1024 * 1024 * 1024,
      }),
    ).not.toThrow();
  });

  it("rejects a nonsensical size", () => {
    expect(() => assertUploadAllowed({ ...ok, sizeBytes: 0 })).toThrow(StoragePolicyError);
    expect(() => assertUploadAllowed({ ...ok, sizeBytes: 1.5 })).toThrow(StoragePolicyError);
  });
});

/* ────────────────────────────────────────────── magic bytes */

describe("content sniffing — the check HeadObject cannot do", () => {
  const bytes = (...b: number[]) => new Uint8Array([...b, ...Array(16).fill(0)]);

  it("identifies real formats", () => {
    expect(detectContentType(bytes(0xff, 0xd8, 0xff))).toBe("image/jpeg");
    expect(detectContentType(bytes(0x89, 0x50, 0x4e, 0x47))).toBe("image/png");
    expect(detectContentType(bytes(0x25, 0x50, 0x44, 0x46))).toBe("application/pdf");
    expect(detectContentType(bytes(0x50, 0x4b, 0x03, 0x04))).toBe("application/zip");
  });

  /** The ticket-05 acceptance criterion, exactly. */
  it("catches a Windows executable renamed to .zip", () => {
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00);
    expect(detectContentType(exe)).toBe("application/x-msdownload");
    expect(() => assertBytesMatchDeclared(exe, "application/zip")).toThrow(/executable/);
  });

  it("catches ELF binaries and shell scripts too", () => {
    expect(() =>
      assertBytesMatchDeclared(bytes(0x7f, 0x45, 0x4c, 0x46), "application/zip"),
    ).toThrow(/executable/);
    expect(() => assertBytesMatchDeclared(bytes(0x23, 0x21), "text/plain")).toThrow(
      /executable/,
    );
  });

  it("catches a PNG masquerading as a PDF", () => {
    expect(() =>
      assertBytesMatchDeclared(bytes(0x89, 0x50, 0x4e, 0x47), "application/pdf"),
    ).toThrow(/don’t match/);
  });

  it("treats docx/xlsx as the zip containers they are", () => {
    const zip = bytes(0x50, 0x4b, 0x03, 0x04);
    expect(() =>
      assertBytesMatchDeclared(
        zip,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).not.toThrow();
  });

  it("lets unrecognised bytes through — unknown is not malicious", () => {
    expect(detectContentType(bytes(0x00, 0x01, 0x02))).toBeNull();
    expect(() => assertBytesMatchDeclared(bytes(0x00, 0x01), "application/zip")).not.toThrow();
  });
});

describe("formatBytes", () => {
  it("reads like something a person wrote", () => {
    expect(formatBytes(500)).toBe("500 bytes");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10MB");
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe("2GB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5MB");
  });
});
