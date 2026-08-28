import { describe, expect, it } from "vitest";
import { canRevealCredentials, gatedDemoUrls, publicDemoView } from "./demo-service";
import type { ProductDoc } from "@/lib/db/models/catalog";

/**
 * The pure halves of §9's rule, tested without a database.
 *
 * `revealCredentials` and `revealDemoUrls` need Mongo and encryption keys and
 * are covered by the integration suite; these are the parts that decide
 * *whether* a secret is handed over and *what shape* leaves the server, which is
 * the part that must never quietly change.
 */

const viewer = (overrides: Partial<Parameters<typeof canRevealCredentials>[1]> = {}) => ({
  isAuthenticated: false,
  ownsProduct: false,
  isStaff: false,
  ...overrides,
});

describe("canRevealCredentials — §9 exposure", () => {
  const cases = [
    // exposure,        viewer,                          allowed
    ["public", viewer(), true],
    ["public", viewer({ isAuthenticated: true }), true],
    ["authenticated", viewer(), false],
    ["authenticated", viewer({ isAuthenticated: true }), true],
    ["owners_only", viewer(), false],
    ["owners_only", viewer({ isAuthenticated: true }), false],
    ["owners_only", viewer({ isAuthenticated: true, ownsProduct: true }), true],
  ] as const;

  it.each(cases)("%s + %o → %s", (exposure, who, allowed) => {
    expect(canRevealCredentials(exposure, who)).toBe(allowed);
  });

  it("lets staff through every exposure — they configure these", () => {
    for (const exposure of ["public", "authenticated", "owners_only"] as const) {
      expect(canRevealCredentials(exposure, viewer({ isStaff: true }))).toBe(true);
    }
  });

  it("denies an exposure value it does not recognise", () => {
    // A new enum member added without a rule here is a compile error first, but
    // stored data can outrun the code — a deny is the only safe fallback.
    const unknown = "partners_only" as Parameters<typeof canRevealCredentials>[0];
    expect(canRevealCredentials(unknown, viewer({ isAuthenticated: true }))).toBe(false);
  });
});

describe("publicDemoView — what leaves the server for everyone", () => {
  const product = {
    demo: {
      exposure: "owners_only",
      publicUrl: "https://demo.example.test",
      customerUrl: "https://demo.example.test/app",
      adminUrl: "https://demo.example.test/admin",
      instructions: "Sign in as the administrator.",
      credentials: [
        {
          role: "Administrator",
          label: "Full access",
          url: "https://demo.example.test/admin",
          username: "admin@demo.test",
          passwordCipher: {
            iv: "aaaa",
            tag: "bbbb",
            ciphertext: "cccc",
            keyVersion: 1,
          },
        },
        { role: "Viewer" },
      ],
    },
  } as unknown as ProductDoc;

  const view = publicDemoView(product);

  it("reports that credentials exist, and for which roles", () => {
    expect(view.hasCredentials).toBe(true);
    expect(view.roles).toEqual([
      { role: "Administrator", label: "Full access", hasPassword: true },
      { role: "Viewer", hasPassword: false },
    ]);
  });

  /**
   * The acceptance criterion, asserted the way it actually fails: by walking
   * the serialised payload for the strings, rather than checking a few named
   * properties. A `credentials` array carried along by a spread would pass a
   * property-by-property check and fail this.
   */
  it("contains no username, ciphertext, IV or gated URL anywhere in the payload", () => {
    const serialised = JSON.stringify(view);

    for (const secret of [
      "admin@demo.test",
      "cccc",
      "aaaa",
      "bbbb",
      "passwordCipher",
      "keyVersion",
      "credentials",
      // The customer and admin URLs are themselves part of what is withheld —
      // a back-office link is a hint worth having.
      "demo.example.test/app",
      "demo.example.test/admin",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  it("keeps the genuinely public parts", () => {
    expect(view.publicUrl).toBe("https://demo.example.test");
    expect(view.instructions).toBe("Sign in as the administrator.");
    expect(view.exposure).toBe("owners_only");
  });

  it("survives a product with no demo configured", () => {
    const bare = {} as ProductDoc;
    expect(publicDemoView(bare)).toEqual({
      exposure: "authenticated",
      roles: [],
      hasCredentials: false,
    });
  });
});

describe("gatedDemoUrls — what the preview page is allowed to frame", () => {
  const product = {
    demo: {
      exposure: "owners_only",
      publicUrl: "https://demo.example.test",
      customerUrl: "https://demo.example.test/app",
      adminUrl: "https://demo.example.test/admin",
      instructions: "Sign in as the administrator.",
      credentials: [
        {
          role: "Administrator",
          username: "admin@demo.test",
          passwordCipher: { iv: "aaaa", tag: "bbbb", ciphertext: "cccc", keyVersion: 1 },
        },
      ],
    },
  } as unknown as ProductDoc;

  it("returns the two gated addresses", () => {
    expect(gatedDemoUrls(product)).toEqual({
      customerUrl: "https://demo.example.test/app",
      adminUrl: "https://demo.example.test/admin",
    });
  });

  /**
   * The reason this function exists rather than the preview page calling
   * `revealCredentials`. Walked as a serialised payload for `publicDemoView`'s
   * reason: a `credentials` array carried along by a spread passes a
   * property-by-property check and fails this.
   */
  it("carries no credential of any kind", () => {
    const serialised = JSON.stringify(gatedDemoUrls(product));

    for (const secret of [
      "admin@demo.test",
      "cccc",
      "aaaa",
      "bbbb",
      "passwordCipher",
      "credentials",
      "username",
      "password",
    ]) {
      expect(serialised).not.toContain(secret);
    }
  });

  /**
   * `publicUrl` is not withheld from anyone, so it is not this function's to
   * hand over — the caller already has it from the cached `publicDemoView`.
   * Returning it here would be a second source for one value.
   */
  it("does not repeat the public URL", () => {
    expect(gatedDemoUrls(product)).not.toHaveProperty("publicUrl");
  });

  it("returns an empty object for a product with no demo at all", () => {
    expect(gatedDemoUrls({} as ProductDoc)).toEqual({});
  });
});
