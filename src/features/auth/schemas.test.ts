import { describe, expect, it } from "vitest";
import {
  loginSchema,
  passwordSchema,
  registerSchema,
  resetPasswordSchema,
  safeRedirectPath,
} from "./schemas";

describe("safeRedirectPath — open-redirect guard", () => {
  it("keeps a same-origin path", () => {
    expect(safeRedirectPath("/dashboard/orders")).toBe("/dashboard/orders");
    expect(safeRedirectPath("/checkout?step=2")).toBe("/checkout?step=2");
  });

  /**
   * Each of these is a working open redirect against a naive
   * `startsWith("/")` check. The protocol-relative form is the one that gets
   * missed: `//evil.com` is a valid URL that browsers resolve against the
   * current scheme.
   */
  it.each([
    ["absolute https", "https://evil.example/phish"],
    ["absolute http", "http://evil.example"],
    ["protocol-relative", "//evil.example/phish"],
    ["backslash-relative", "/\\evil.example"],
    ["scheme-ish", "javascript:alert(1)"],
    ["bare host", "evil.example"],
  ])("rejects %s", (_label, value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });

  it("falls back when absent or empty", () => {
    expect(safeRedirectPath(undefined)).toBe("/dashboard");
    expect(safeRedirectPath("")).toBe("/dashboard");
    expect(safeRedirectPath(undefined, "/")).toBe("/");
  });
});

describe("password policy", () => {
  it("requires length rather than character classes", () => {
    // NIST SP 800-63B: length is what matters; composition rules produce
    // predictable substitutions.
    expect(passwordSchema.safeParse("correct horse battery").success).toBe(true);
    expect(passwordSchema.safeParse("Sh0rt!").success).toBe(false);
  });

  it("caps length so a huge input can't burn CPU in the hash", () => {
    expect(passwordSchema.safeParse("a".repeat(129)).success).toBe(false);
  });
});

describe("registration input", () => {
  it("normalises the email", () => {
    const parsed = registerSchema.parse({
      name: "Ada",
      email: "  Ada@Example.COM ",
      password: "a-long-enough-password",
    });
    expect(parsed.email).toBe("ada@example.com");
  });

  it("treats a blank company name as absent, not as an empty name", () => {
    const parsed = registerSchema.parse({
      name: "Ada",
      email: "ada@example.com",
      password: "a-long-enough-password",
      organizationName: "   ",
    });
    expect(parsed.organizationName).toBeUndefined();
  });

  it("rejects a malformed address", () => {
    const result = registerSchema.safeParse({
      name: "Ada",
      email: "not-an-email",
      password: "a-long-enough-password",
    });
    expect(result.success).toBe(false);
  });
});

describe("login input", () => {
  it("reads the checkbox's 'on' as true and its absence as false", () => {
    expect(
      loginSchema.parse({ email: "a@b.com", password: "x", rememberMe: "on" }).rememberMe,
    ).toBe(true);
    expect(loginSchema.parse({ email: "a@b.com", password: "x" }).rememberMe).toBe(false);
  });

  it("does not apply the password policy to sign-in", () => {
    // An existing account may predate the current minimum; refusing to *try*
    // would lock people out with a validation error instead of a sign-in
    // failure they can act on.
    expect(loginSchema.safeParse({ email: "a@b.com", password: "old" }).success).toBe(true);
  });
});

describe("reset input", () => {
  it("reports a mismatch against the confirm field, not the password field", () => {
    const result = resetPasswordSchema.safeParse({
      token: "t",
      password: "a-long-enough-password",
      confirmPassword: "something-else-entirely",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});
