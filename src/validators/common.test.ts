import { describe, expect, it } from "vitest";
import { countFromForm, optionalId, optionalText, optionalUrl } from "./common";

/**
 * The first tests in `src/validators/` — which is why the bugs below shipped.
 *
 * Every one of these asserts the same thing from a different angle: **an empty
 * text input submits `""`, not `undefined`**, so `.optional()` alone does not make
 * a field optional. Four "(optional)" fields refused to save while blank because
 * of it, and three number fields silently became zero.
 *
 * These are the helpers the section schemas now lean on, so a regression here is
 * a regression in every form at once. They are pure, so there is no database and
 * no request context; the whole file is about a dozen values.
 */

describe("optionalUrl", () => {
  it("treats blank and whitespace as absent, not as a malformed URL", () => {
    // The reported bug, at its root. `z.url().optional()` said "Invalid URL"
    // about a field the person had deliberately left empty.
    expect(optionalUrl().parse("")).toBeUndefined();
    expect(optionalUrl().parse("   ")).toBeUndefined();
    expect(optionalUrl().parse(undefined)).toBeUndefined();
  });

  it("trims a pasted value rather than refusing it", () => {
    // Copying a URL out of a browser or an email routinely brings whitespace.
    expect(optionalUrl().parse("  https://example.com/demo  ")).toBe(
      "https://example.com/demo",
    );
  });

  it("still refuses something that is genuinely not a URL", () => {
    // The fix widens what counts as *absent*. It must not widen what counts as
    // valid — a bare hostname is the mistake people actually make.
    expect(optionalUrl().safeParse("example.com").success).toBe(false);
  });

  it("keeps its own message instead of degrading to a union error", () => {
    // Why `z.preprocess` and not `z.union([z.literal(""), z.url()])`: a union
    // reports `invalid_union` and loses the inner message. The complaint being
    // fixed was that "Invalid URL" was unhelpful, so a fix that made the message
    // *worse* on a real mistake would be a trade, not a fix.
    const result = optionalUrl().safeParse("example.com");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toBe(
        "Enter a full address, like https://example.com",
      );
    }
  });
});

describe("optionalId", () => {
  it("accepts the empty string a <select> with no choice submits", () => {
    // A native `<option value="">` is what makes "no specific type" expressible;
    // this is the half of that which lets the step save.
    expect(optionalId().parse("")).toBeUndefined();
  });

  it("passes a real id through and refuses a malformed one", () => {
    expect(optionalId().parse("6a80c46f6c887b38e2f0e0b4")).toBe("6a80c46f6c887b38e2f0e0b4");
    expect(optionalId().safeParse("not-an-id").success).toBe(false);
  });
});

describe("countFromForm", () => {
  it("falls back rather than coercing '' to zero", () => {
    // `Number("")` is 0, so `z.coerce.number().min(1)` reported "Too small" on a
    // blank Activations field, and `.min(0).default(12)` silently stored **zero
    // months** of support where the placeholder promised twelve. Neither was
    // visible as a bug; one was an unexplained refusal and the other was wrong data.
    expect(countFromForm(1, { min: 1, max: 10_000 }).parse("")).toBe(1);
    expect(countFromForm(12, { max: 120 }).parse("")).toBe(12);
    expect(countFromForm(12, { max: 120 }).parse("   ")).toBe(12);
    expect(countFromForm(0, { max: 999 }).parse(undefined)).toBe(0);
  });

  it("coerces a real value and enforces the bounds", () => {
    expect(countFromForm(1, { min: 1, max: 10_000 }).parse("5")).toBe(5);
    expect(countFromForm(1, { min: 1, max: 10_000 }).safeParse("0").success).toBe(false);
    expect(countFromForm(12, { max: 120 }).safeParse("900").success).toBe(false);
    expect(countFromForm(12, { max: 120 }).safeParse("1.5").success).toBe(false);
  });

  it("takes zero as a real answer when the floor allows it", () => {
    // The point of the fallback is that *blank* is not zero. Typed zero still is.
    expect(countFromForm(12, { max: 120 }).parse("0")).toBe(0);
  });
});

describe("optionalText", () => {
  it("behaves the same way, which is where the pattern came from", () => {
    // Asserted so the family stays a family: this one was already correct, and
    // the three above exist because it had no siblings for the non-string cases.
    expect(optionalText().parse("")).toBeUndefined();
    expect(optionalText().parse("  hello  ")).toBe("hello");
  });
});
