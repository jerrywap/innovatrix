import { describe, expect, it } from "vitest";
import { ScopeError, orgFilter, vendorFilter } from "./scope";

/**
 * The bug these guards exist to make impossible is documented at the top of
 * `scope.ts`: `...(scope.id ? { id } : {})` is correct for a customer and correct
 * for staff, and **silently wrong for a blank string** — an empty string is falsy,
 * so it removes the filter entirely and returns every tenant's rows. The widening
 * is invisible at the call site and the code reads as though it were scoped.
 *
 * `orgFilter` is exercised end to end by `tenant-isolation.integration.test.ts`
 * against a real database. These are the cheap unit assertions of the same
 * property, and the only coverage `vendorFilter` has before vendor ticket 04 gives
 * it a caller — a guard with no test is a guard somebody deletes as unused.
 */

const OID = "652f1a2b3c4d5e6f70819200";

describe.each([
  ["orgFilter", orgFilter, "organizationId"] as const,
  ["vendorFilter", vendorFilter, "vendorId"] as const,
])("%s", (_name, filter, field) => {
  it("returns an empty filter for a staff caller, who passes nothing", () => {
    expect(filter({})).toEqual({});
  });

  it("narrows to the id it was given", () => {
    const result = filter({ [field]: OID } as never) as Record<string, unknown>;
    expect(String(result[field])).toBe(OID);
  });

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["a tab", "\t"],
  ])("throws rather than becoming god mode for %s", (_label, value) => {
    expect(() => filter({ [field]: value } as never)).toThrow(ScopeError);
  });

  it("names the mistake in the message, because the call site looks correct", () => {
    expect(() => filter({ [field]: "" } as never)).toThrow(/not a scope/i);
  });

  it("still rejects an id that is not an ObjectId", () => {
    // Not a `ScopeError` — a malformed id is a caller bug of a different kind, and
    // `toObjectId` already refuses it with the value named.
    expect(() => filter({ [field]: "not-an-id" } as never)).toThrow();
  });
});
