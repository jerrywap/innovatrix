import { describe, expect, it } from "vitest";
import { collapseByProduct } from "./entitlement-service";
import type { EntitlementView } from "./entitlement-service";

/**
 * One card per product, and which of several rows survives.
 *
 * ## Why a unit test
 *
 * The fold is a pure function over view models. Proving it through the database
 * would mean a 27th copy of the integration preamble to assert something that
 * touches no index, no transaction and no tenancy filter — which `AGENTS.md`
 * names as the test to write as a unit.
 *
 * ## What actually matters here
 *
 * The survivor must be the row `authoriseDownload` would authorise against.
 * `entitlements.findForProduct` picks with `sort({ status: 1, createdAt: -1 })`,
 * so the fold reproduces that ordering; if the two disagree the library shows a
 * card whose download then refuses, which is the failure this exists to prevent.
 */

function view(
  over: Partial<EntitlementView> & { id: string; productId: string },
): EntitlementView {
  const { productId, ...rest } = over;
  return {
    status: "active",
    product: {
      id: productId,
      slug: `p-${productId}`,
      name: `Product ${productId}`,
      customisable: false,
      hasDemo: false,
    },
    supportActive: true,
    updatesActive: true,
    orderId: `order-${over.id}`,
    acquiredFree: false,
    alsoOwned: 0,
    ...rest,
  };
}

describe("collapsing the library by product", () => {
  it("leaves a single purchase alone", () => {
    const rows = collapseByProduct([view({ id: "e1", productId: "a" })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.alsoOwned).toBe(0);
  });

  it("shows one card when the same product was bought twice", () => {
    const rows = collapseByProduct([
      view({ id: "newest", productId: "a" }),
      view({ id: "older", productId: "a" }),
    ]);

    expect(rows).toHaveLength(1);
    // Newest-first arrives from the repository, so the first one wins.
    expect(rows[0]!.id).toBe("newest");
    expect(rows[0]!.alsoOwned).toBe(1);
  });

  it("keeps the active row when a newer one is revoked", () => {
    // Bought, refunded, bought again — or the reverse. The live row is the
    // answer, whichever order they arrived in.
    const rows = collapseByProduct([
      view({ id: "revoked", productId: "a", status: "revoked" }),
      view({ id: "live", productId: "a", status: "active" }),
    ]);

    expect(rows[0]!.id).toBe("live");
    expect(rows[0]!.alsoOwned).toBe(1);
  });

  it("prefers suspended over revoked when nothing is active", () => {
    const rows = collapseByProduct([
      view({ id: "revoked", productId: "a", status: "revoked" }),
      view({ id: "suspended", productId: "a", status: "suspended" }),
    ]);

    expect(rows[0]!.id).toBe("suspended");
  });

  it("does not merge different products, and keeps their order", () => {
    const rows = collapseByProduct([
      view({ id: "e1", productId: "a" }),
      view({ id: "e2", productId: "b" }),
      view({ id: "e3", productId: "a" }),
    ]);

    expect(rows.map((row) => row.product.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.alsoOwned)).toEqual([1, 0]);
  });
});
