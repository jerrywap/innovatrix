import { describe, expect, it } from "vitest";
import { fail, ok, withAction } from "./action-result";
import {
  ConflictError,
  GENERIC_ERROR_MESSAGE,
  ProviderUnavailableError,
  ValidationError,
} from "./errors";

/**
 * The boundary that decides what a customer is told when something throws.
 *
 * It had no tests, and the gap cost an afternoon: a Mongoose `ValidationError`
 * — our data disagreeing with our schema — is not a `DomainError`, so it fell
 * to the generic branch and read exactly like a transient blip. A thousand
 * products were unbuyable and the message said "try again".
 */

/** Mongoose's error, by shape — the real one carries `name` and `errors`. */
function mongooseValidationError(): Error {
  const error = new Error(
    "Order validation failed: items.0.licenceType: `single_site` is not a valid enum value.",
  );
  error.name = "ValidationError";
  (error as Error & { errors: unknown }).errors = { "items.0.licenceType": {} };
  return error;
}

describe("withAction", () => {
  it("passes a success through untouched", async () => {
    const result = await withAction(async () => ok({ id: 1 }));
    expect(result).toEqual({ ok: true, data: { id: 1 } });
  });

  it("returns a ValidationError's message and field errors", async () => {
    const result = await withAction(async () => {
      throw new ValidationError("Please check the highlighted fields.", {
        email: ["Required."],
      });
    });

    expect(result).toMatchObject({
      ok: false,
      code: "VALIDATION",
      error: "Please check the highlighted fields.",
      fieldErrors: { email: ["Required."] },
    });
  });

  it("returns a domain error's own message", async () => {
    const result = await withAction(async () => {
      throw new ConflictError("That order has already been paid.");
    });

    expect(result).toMatchObject({
      ok: false,
      code: "CONFLICT",
      error: "That order has already been paid.",
    });
  });

  it("keeps a provider outage modelled rather than generic", async () => {
    const result = await withAction(async () => {
      throw new ProviderUnavailableError("paystack", new TypeError("fetch failed"));
    });

    if (result.ok) throw new Error("expected failure");
    expect(result.code).toBe("PROVIDER_UNAVAILABLE");
    expect(result.error).not.toContain(GENERIC_ERROR_MESSAGE);
    // The cause is for the log, never for the customer.
    expect(result.error).not.toContain("fetch failed");
  });

  describe("an unmodelled throw", () => {
    it("is redacted to the generic message", async () => {
      const result = await withAction(async () => {
        throw new Error("mongodb://user:hunter2@cluster0/innovatrix timed out");
      });

      if (result.ok) throw new Error("expected failure");
      expect(result.code).toBe("INTERNAL");
      expect(result.error).toContain(GENERIC_ERROR_MESSAGE);
      expect(result.error).not.toContain("hunter2");
      expect(result.error).not.toContain("mongodb://");
    });

    it("carries a quotable reference that ties the screen to the log", async () => {
      const result = await withAction(async () => {
        throw mongooseValidationError();
      });

      if (result.ok) throw new Error("expected failure");
      expect(result.reference).toMatch(/^E-[0-9A-F]{6}$/);
      expect(result.error).toContain(result.reference!);
    });

    it("does not leak the schema path a Mongoose failure names", async () => {
      const result = await withAction(async () => {
        throw mongooseValidationError();
      });

      if (result.ok) throw new Error("expected failure");
      expect(result.error).not.toContain("licenceType");
      expect(result.error).not.toContain("single_site");
    });

    it("gives each failure its own reference", async () => {
      const first = await withAction(async () => {
        throw new Error("boom");
      });
      const second = await withAction(async () => {
        throw new Error("boom");
      });

      if (first.ok || second.ok) throw new Error("expected failures");
      expect(first.reference).not.toBe(second.reference);
    });
  });

  it("rethrows Next's control flow rather than swallowing navigation", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), {
      digest: "NEXT_REDIRECT;push;/x",
    });

    await expect(
      withAction(async () => {
        throw redirect;
      }),
    ).rejects.toBe(redirect);
  });
});

describe("fail", () => {
  it("omits absent options rather than writing undefined keys", () => {
    expect(fail("nope")).toEqual({ ok: false, error: "nope" });
  });
});
