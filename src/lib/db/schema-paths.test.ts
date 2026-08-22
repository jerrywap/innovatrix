import { describe, expect, it } from "vitest";
import { Product, Taxonomy } from "./models/catalog";
import { Vendor, VendorMember } from "./models/vendors";

/**
 * Paths a **query filter** depends on.
 *
 * ## Why this file exists
 *
 * `connectToDatabase()` sets `strictQuery: true`, which makes Mongoose silently drop
 * filter conditions on paths the registered schema does not declare. That is a
 * sensible default for typos in a read — and a **fail-open** for a scope: a query
 * filtered by `vendorId` against a schema without one is not an error, it is a query
 * across every vendor, and nothing anywhere reports it.
 *
 * It happened. A dev server started before `vendorId` was added to `productSchema`
 * kept that schema (`defineModel` is idempotent by design, so a long-running process
 * never re-registers), served one vendor a first-party product's edit form, and the
 * identical call in a fresh process correctly returned `null`. The query, the scope
 * and the session were all correct.
 *
 * In production the schema always matches the process, so it cannot happen there —
 * which is exactly why it needs asserting: the failure is invisible, it only appears
 * where nobody is looking, and it opens rather than closes.
 *
 * So: any field that a **tenancy filter** relies on gets a line here. The runtime
 * guard in `ProductRepository.assertVendorPathExists` is the backstop; this is the
 * one that fails in CI before anybody ships a removal.
 */

describe("schema paths that a scope filter depends on", () => {
  it("declares Product.vendorId, or every vendor-scoped read is unscoped", () => {
    expect(Product.schema.path("vendorId")).toBeDefined();
  });

  /** Denormalised, and the `vend:` facet plus card attribution read them. */
  it("declares the denormalised vendor fields the marketplace projects", () => {
    expect(Product.schema.path("vendorSlug")).toBeDefined();
    expect(Product.schema.path("vendorName")).toBeDefined();
  });

  it("declares the paths the organisation scope depends on", () => {
    // `orgFilter` has the same exposure for every org-scoped collection. Asserting one
    // long-standing case alongside the new one keeps the reason legible: this is about
    // tenancy filters generally, not about vendors.
    expect(VendorMember.schema.path("vendorId")).toBeDefined();
    expect(VendorMember.schema.path("userId")).toBeDefined();
    expect(VendorMember.schema.path("status")).toBeDefined();
  });

  it("declares the paths the vendor status gates read", () => {
    expect(Vendor.schema.path("status")).toBeDefined();
    expect(Vendor.schema.path("slug")).toBeDefined();
    expect(Vendor.schema.path("deletedAt")).toBeDefined();
  });

  /**
   * The catalogue split, and this is the cheapest four lines in it.
   *
   * `strictQuery: true` **silently drops** a filter condition on an undeclared
   * path. So if `catalogue` ever leaves either schema — or a long-running process
   * holds a stale model — `{ catalogue: "template" }` stops narrowing anything and
   * `/templates` serves the entire catalogue. No error, no empty page: the wrong
   * rows, looking right. That is the exact incident this file was written after.
   */
  /**
   * The linked-listing edge — one template, one full script.
   *
   * `strictQuery: true` drops a filter on an undeclared path, so a stale schema
   * turns `findOne({ scriptListingId: id })` into `findOne({})` — an arbitrary
   * product, with no error. The authoring screen would then report every script as
   * already linked, and `softDelete` would refuse deletions at random.
   *
   * `syncIndexes` also builds from the schema, so a missing path silently means a
   * missing **partial unique index** — and then two templates per script.
   */
  it("declares the path the linked-listing lookup depends on", () => {
    expect(Product.schema.path("scriptListingId")).toBeDefined();
  });

  it("declares the paths the catalogue split depends on", () => {
    expect(Product.schema.path("catalogue")).toBeDefined();
    expect(Taxonomy.schema.path("catalogue")).toBeDefined();
  });
});
