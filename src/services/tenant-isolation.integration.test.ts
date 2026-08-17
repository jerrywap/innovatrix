import { afterAll, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * Org B cannot reach Org A's anything — §88, ticket 26.
 *
 * ## Why this is one file rather than an assertion inside each service's suite
 *
 * Because the question is not "does the invoice loader scope correctly", it is
 * "is there **any** org-scoped resource that doesn't". Spread across nine
 * suites, the resource nobody wrote a test for looks exactly like the resource
 * that has no test *file* — invisible. Here, a new org-scoped loader that is not
 * in this list is a gap somebody can see.
 *
 * ## Every case is the same shape
 *
 * Create the record under Org A. Ask for it as Org B, using **Org A's real id**
 * — not a made-up one, because a made-up id proves only that the database has
 * no such row. The correct answer is always "nothing", never a partial view and
 * never an error that distinguishes "not yours" from "does not exist".
 *
 * ## What this file does *not* cover, and where that is covered instead
 *
 * The DAL layer above these functions is what supplies `organizationId`, and it
 * takes it from the session (`requireOrg()`), never from the request. That
 * property is asserted in `auth.integration.test.ts`. This file assumes the
 * scope argument is honest and proves the query honours it — the two together
 * are the isolation guarantee.
 */

let mongoose: typeof import("mongoose").default;

let invoiceView: typeof import("@/features/invoices/invoice-view");
let quoteView: typeof import("@/features/quotes/quote-view");
let requestService: typeof import("@/services/requests/request-service");
let entitlementService: typeof import("@/services/entitlements/entitlement-service");
let messagingService: typeof import("@/services/messaging/messaging-service");
let aiConversations: typeof import("@/services/ai/conversation-service");

let billing: typeof import("@/lib/db/models/billing");
let commerce: typeof import("@/lib/db/models/commerce");
let requests: typeof import("@/lib/db/models/requests");
let communication: typeof import("@/lib/db/models/communication");
let identity: typeof import("@/lib/db/models/identity");
let catalog: typeof import("@/lib/db/models/catalog");
let errors: typeof import("@/lib/errors");
let scope: typeof import("@/lib/auth/scope");
let productService: typeof import("@/services/catalog/product-service");

/** Org A owns everything. Org B is authenticated and is the attacker. */
/* Vendor ticket 04 — a second axis of tenancy beside the organisation one. */
const VENDOR_A = "6b00c46f6c887b38e2f0e0d1";
const VENDOR_B = "6b00c46f6c887b38e2f0e0d2";
const VENDOR_A_PRODUCT = "6b00c46f6c887b38e2f0e0d3";

const ORG_A = "6b00c46f6c887b38e2f0e0a1";
const ORG_B = "6b00c46f6c887b38e2f0e0b1";

const USER_A = "6b00c46f6c887b38e2f0e0a2";
const USER_B = "6b00c46f6c887b38e2f0e0b2";

const PRODUCT = "6b00c46f6c887b38e2f0e0c1";
const REQUEST = "6b00c46f6c887b38e2f0e0d1";
const QUOTE = "6b00c46f6c887b38e2f0e0d2";
const INVOICE = "6b00c46f6c887b38e2f0e0d3";
const ORDER = "6b00c46f6c887b38e2f0e0d4";
const ENTITLEMENT = "6b00c46f6c887b38e2f0e0d5";
const VERSION = "6b00c46f6c887b38e2f0e0d6";
const FILE = "6b00c46f6c887b38e2f0e0d7";

const MONEY = { amount: 100_000, currency: "GBP" };

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "tenant_isolation_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");
  vi.stubEnv("JOBS_WORKER", "off");

  mongoose = (await import("mongoose")).default;

  invoiceView = await import("@/features/invoices/invoice-view");
  quoteView = await import("@/features/quotes/quote-view");
  requestService = await import("@/services/requests/request-service");
  entitlementService = await import("@/services/entitlements/entitlement-service");
  messagingService = await import("@/services/messaging/messaging-service");
  aiConversations = await import("@/services/ai/conversation-service");
  productService = await import("@/services/catalog/product-service");

  billing = await import("@/lib/db/models/billing");
  commerce = await import("@/lib/db/models/commerce");
  requests = await import("@/lib/db/models/requests");
  communication = await import("@/lib/db/models/communication");
  identity = await import("@/lib/db/models/identity");
  catalog = await import("@/lib/db/models/catalog");
  errors = await import("@/lib/errors");
  scope = await import("@/lib/auth/scope");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();

  await seed();
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

/**
 * One fixture for the whole file, built once.
 *
 * Nothing here mutates, so per-test isolation would buy nothing and cost a
 * rebuild per case. Every test is a read that must come back empty.
 */
async function seed(): Promise<void> {
  await identity.Organization.create([
    { _id: ORG_A, name: "Alpha Ltd", slug: "alpha", billingEmail: "a@alpha.test" },
    { _id: ORG_B, name: "Bravo Ltd", slug: "bravo", billingEmail: "b@bravo.test" },
  ]);

  await identity.User.create([
    { _id: USER_A, name: "Ana", email: "ana@alpha.test", emailVerified: true },
    { _id: USER_B, name: "Ben", email: "ben@bravo.test", emailVerified: true },
  ]);

  await identity.OrganizationMember.create([
    { organizationId: ORG_A, userId: USER_A, role: "owner", status: "active" },
    { organizationId: ORG_B, userId: USER_B, role: "owner", status: "active" },
  ]);

  // No `vendorId` — Atlas is **first-party**, and it is the control for every vendor
  // assertion below: absence must keep behaving exactly as it did before ownership
  // existed.
  await catalog.Product.create({
    _id: PRODUCT,
    name: "Atlas",
    slug: "atlas",
    summary: "Alpha's product",
    status: "published",
    prices: [MONEY],
    currentVersionId: VERSION,
  });

  await catalog.Product.create({
    _id: VENDOR_A_PRODUCT,
    name: "Northwind Dispatch",
    slug: "northwind-dispatch",
    summary: "Vendor A's product",
    status: "draft",
    vendorId: VENDOR_A,
    vendorSlug: "northwind-labs",
    vendorName: "Northwind Labs",
    facets: ["vend:northwind-labs"],
  });

  await catalog.ProductVersion.create({
    _id: VERSION,
    productId: PRODUCT,
    version: "1.0.0",
    status: "released",
  });

  await catalog.ProductFile.create({
    _id: FILE,
    productId: PRODUCT,
    versionId: VERSION,
    kind: "application_package",
    storageKey: "innovatrix/test/atlas-1.0.0.zip",
    filename: "atlas-1.0.0.zip",
    contentType: "application/zip",
    sizeBytes: 1024,
    scanStatus: "pending",
  });

  await requests.CustomerRequest.create({
    _id: REQUEST,
    reference: "REQ-2026-9001",
    organizationId: ORG_A,
    userId: USER_A,
    kind: "customization",
    status: "submitted",
    title: "Alpha's private request",
  });

  await billing.Quote.create({
    _id: QUOTE,
    reference: "QUO-2026-9001",
    organizationId: ORG_A,
    requestId: REQUEST,
    version: 1,
    status: "issued",
    title: "Alpha's private quote",
    items: [],
    currency: "GBP",
    subtotal: MONEY,
    total: MONEY,
    expiresAt: new Date(Date.now() + 30 * 86_400_000),
  });

  await billing.Invoice.create({
    _id: INVOICE,
    reference: "INV-2026-9001",
    organizationId: ORG_A,
    sourceType: "quote",
    sourceId: QUOTE,
    portion: "full",
    items: [],
    currency: "GBP",
    subtotal: MONEY,
    total: MONEY,
    amountPaid: { amount: 0, currency: "GBP" },
    status: "issued",
  });

  await commerce.Order.create({
    _id: ORDER,
    reference: "ORD-2026-9001",
    organizationId: ORG_A,
    userId: USER_A,
    status: "fulfilled",
    currency: "GBP",
    items: [],
    subtotal: MONEY,
    total: MONEY,
    paymentMethod: "online",
  });

  await commerce.Entitlement.create({
    _id: ENTITLEMENT,
    organizationId: ORG_A,
    productId: PRODUCT,
    orderId: ORDER,
    orderLineId: "line-1",
    purchasedVersionId: VERSION,
    status: "active",
    updatesUntil: new Date(Date.now() + 365 * 86_400_000),
  });

  await communication.Conversation.create({
    organizationId: ORG_A,
    subjectType: "request",
    subjectId: REQUEST,
    participantUserIds: [USER_A],
  });
}

/* ────────────────────────────────────────────── the suite */

describe("the fixture is real", () => {
  it("returns Org A's records to Org A, so an empty result means scoping", async () => {
    // Without this every assertion below would pass against a broken loader
    // that returns null unconditionally.
    expect(await invoiceView.loadInvoice(INVOICE, { organizationId: ORG_A })).not.toBeNull();
    expect(await quoteView.loadQuote(QUOTE, { organizationId: ORG_A })).not.toBeNull();
    expect(
      await requestService.findByReference("REQ-2026-9001", { organizationId: ORG_A }),
    ).not.toBeNull();
    expect(await entitlementService.getOwnedSoftware(ENTITLEMENT, ORG_A)).not.toBeNull();
    expect(await entitlementService.listOwnedSoftware(ORG_A)).toHaveLength(1);
  });
});

describe("Org B is refused Org A's records — §88", () => {
  it("invoices", async () => {
    expect(await invoiceView.loadInvoice(INVOICE, { organizationId: ORG_B })).toBeNull();
    expect(await invoiceView.listInvoicesForOrganization(ORG_B)).toHaveLength(0);
  });

  it("quotes", async () => {
    expect(await quoteView.loadQuote(QUOTE, { organizationId: ORG_B })).toBeNull();
  });

  it("requests, by reference", async () => {
    // The reference is printed on emails and quoted in support threads, so it
    // is the id most likely to be guessed or shared. It is not a credential.
    expect(
      await requestService.findByReference("REQ-2026-9001", { organizationId: ORG_B }),
    ).toBeNull();
  });

  it("entitlements and My Software", async () => {
    expect(await entitlementService.getOwnedSoftware(ENTITLEMENT, ORG_B)).toBeNull();
    expect(await entitlementService.listOwnedSoftware(ORG_B)).toHaveLength(0);
  });

  it("downloads — the one that would hand over the paid artefact", async () => {
    await expect(entitlementService.authoriseDownload(FILE, ORG_B)).rejects.toBeInstanceOf(
      errors.ForbiddenError,
    );

    // And it works for the org that bought it, so the refusal above is scoping
    // rather than the file being unreachable for some other reason.
    await expect(entitlementService.authoriseDownload(FILE, ORG_A)).resolves.toBeTruthy();
  });

  it("conversations", async () => {
    const thread = await messagingService.customerThread({
      organizationId: ORG_B,
      subjectType: "request",
      subjectId: REQUEST,
      viewerUserId: USER_B,
    });

    expect(thread).toHaveLength(0);
  });

  it("orders", async () => {
    const order = await commerce.Order.findOne({
      _id: ORDER,
      organizationId: ORG_B,
    }).lean();

    expect(order).toBeNull();
  });
});

describe("a staff scope is the absence of one, not a wildcard string", () => {
  it("returns the record when no organisation is supplied", async () => {
    /*
     * Staff see across organisations (§30), expressed as *omitting* the scope
     * rather than passing a sentinel. Worth asserting, because the failure mode
     * of a sentinel — `organizationId: "*"` or `"all"` — is that a customer who
     * discovers the string gets the same view.
     */
    expect(await invoiceView.loadInvoice(INVOICE, {})).not.toBeNull();
    expect(await requestService.findByReference("REQ-2026-9001", {})).not.toBeNull();
  });

  it("refuses a blank organisation rather than treating it as no scope", async () => {
    /*
     * The realistic accident is `organizationId: someValue ?? ""`, and before
     * ticket 26 it was the dangerous one: an empty string is falsy, so the
     * `scope.organizationId ? … : {}` these loaders used **dropped the filter
     * entirely** and returned another organisation's record. The widening was
     * invisible at the call site.
     *
     * Found by writing this test and noticing that the only assertion that
     * would pass was "returns the record".
     */
    await expect(
      invoiceView.loadInvoice(INVOICE, { organizationId: "" }),
    ).rejects.toBeInstanceOf(scope.ScopeError);

    await expect(quoteView.loadQuote(QUOTE, { organizationId: "  " })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );

    await expect(
      requestService.findByReference("REQ-2026-9001", { organizationId: "" }),
    ).rejects.toBeInstanceOf(scope.ScopeError);
  });
});

/**
 * Vendor ticket 04 — the second axis.
 *
 * Same shape as the organisation cases above, deliberately: create as A, ask as B,
 * expect nothing. The difference worth stating is the **error type**. A cross-vendor
 * read raises `NotFoundError`, not `ForbiddenError`, for the reason the AI-conversation
 * case below documents: the refusal and the absence must be indistinguishable, or the
 * workspace becomes an oracle for which product ids are real. A vendor product id is a
 * URL somebody will try.
 */
describe("Vendor B is refused Vendor A's products", () => {
  it("has a real fixture — the control", async () => {
    const own = await productService.listForVendor({ vendorId: VENDOR_A });
    expect(own.total).toBe(1);
    expect(own.items[0]!.name).toBe("Northwind Dispatch");
  });

  it("does not list one vendor's products for another", async () => {
    const theirs = await productService.listForVendor({ vendorId: VENDOR_B });
    expect(theirs.total).toBe(0);
    expect(theirs.items).toEqual([]);
  });

  /**
   * Absence of an owner must not read as "mine" — the case that caught a real leak.
   *
   * A dev server whose registered schema predated `Product.vendorId` dropped the filter
   * under `strictQuery` and served a vendor an Innovatrix product's edit form. Both
   * halves are asserted: the list, and the **single-document read** the wizard uses,
   * because it was the second that leaked while the first looked fine.
   */
  it("does not return a first-party product to any vendor", async () => {
    const all = await productService.listForVendor({ vendorId: VENDOR_A });
    expect(all.items.map((p) => p.slug)).not.toContain("atlas");

    const { products } = await import("@/repositories/product.repository");
    expect(await products.findScoped(PRODUCT, { vendorId: VENDOR_A })).toBeNull();

    // Non-vacuity: the fixture is genuinely there and genuinely unowned, so the two
    // nulls above mean scoping rather than a missing document.
    const unscoped = await catalog.Product.findById(PRODUCT).lean();
    expect(unscoped).not.toBeNull();
    expect(unscoped!.vendorId).toBeUndefined();
  });

  /**
   * The runtime backstop for the same failure, asserted rather than trusted.
   *
   * `strictQuery: true` silently drops a filter on an undeclared path, so a scoped read
   * against a schema without `vendorId` would be a read across every vendor. The
   * repository refuses instead. `schema-paths.test.ts` catches a removal in CI; this
   * proves the guard fires if one ever reaches a running process.
   */
  it("refuses a vendor-scoped query rather than running it unscoped", async () => {
    const { products } = await import("@/repositories/product.repository");
    const { RepositoryError } = await import("@/repositories/base");

    const path = catalog.Product.schema.path("vendorId");
    catalog.Product.schema.remove("vendorId");
    try {
      await expect(
        products.findScoped(VENDOR_A_PRODUCT, { vendorId: VENDOR_A }),
      ).rejects.toBeInstanceOf(RepositoryError);
    } finally {
      // Put it back, or every later test in this file runs against a broken schema.
      catalog.Product.schema.add({ vendorId: path.options });
    }

    // And it works again once the path is there.
    expect(await products.findScoped(VENDOR_A_PRODUCT, { vendorId: VENDOR_A })).not.toBeNull();
  });

  it("refuses a section save on another vendor's product, as a 404", async () => {
    await expect(
      productService.saveSection(
        VENDOR_A_PRODUCT,
        "basics",
        { name: "Hijacked" },
        { type: "vendor", userId: USER_B, vendorId: VENDOR_B },
        { vendorId: VENDOR_B },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);

    // And nothing was written.
    const after = await catalog.Product.findById(VENDOR_A_PRODUCT).lean();
    expect(after!.name).toBe("Northwind Dispatch");
  });

  it("refuses a classification save, which is the facet-rewriting path", async () => {
    await expect(
      productService.saveClassification(
        VENDOR_A_PRODUCT,
        { categoryIds: [], industryIds: [], technologyIds: [] },
        { type: "vendor", userId: USER_B, vendorId: VENDOR_B },
        { vendorId: VENDOR_B },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  it("refuses a transition on another vendor's product", async () => {
    await expect(
      productService.transition(
        VENDOR_A_PRODUCT,
        "internal_review",
        { type: "vendor", userId: USER_B, vendorId: VENDOR_B },
        { scope: { vendorId: VENDOR_B } },
      ),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  /**
   * The owner's own classification save must **keep** the `vend:` term.
   *
   * This is the trap vendor ticket 04 names, asserted rather than trusted: facets are
   * rewritten wholesale, so a term not re-derived here is silently wiped and the
   * product quietly stops appearing under its own vendor. Nothing errors.
   */
  it("preserves the vendor facet when its owner edits the classification", async () => {
    await productService.saveClassification(
      VENDOR_A_PRODUCT,
      { categoryIds: [], industryIds: [], technologyIds: [] },
      { type: "vendor", userId: USER_A, vendorId: VENDOR_A },
      { vendorId: VENDOR_A },
    );

    const after = await catalog.Product.findById(VENDOR_A_PRODUCT).lean();
    expect(after!.facets).toContain("vend:northwind-labs");
  });

  it("refuses a blank vendor scope rather than treating it as no scope", async () => {
    // The same accident as `organizationId: value ?? ""`, and the same answer.
    await expect(productService.listForVendor({ vendorId: "" })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );

    await expect(productService.listForVendor({ vendorId: "  " })).rejects.toBeInstanceOf(
      scope.ScopeError,
    );
  });

  it("still lets staff read across every vendor, by omitting the scope", async () => {
    // Staff scope is `undefined`, and nothing else is.
    const product = await productService.readinessFor(
      (await catalog.Product.findById(VENDOR_A_PRODUCT).lean())!,
    );
    expect(product.gaps.length).toBeGreaterThan(0);
  });
});

describe("AI conversations", () => {
  it("does not return one organisation's conversation to another", async () => {
    const conversation = await aiConversations.startOrResume({
      contextType: "customization",
      organizationId: ORG_A,
      userId: USER_A,
      productId: PRODUCT,
    });

    const id = String(conversation._id);

    await expect(
      aiConversations.getConversation(id, { organizationId: ORG_A, userId: USER_A }),
    ).resolves.toBeTruthy();

    /*
     * `NotFoundError`, not `ForbiddenError`, and that is the right answer here.
     *
     * A transcript is the customer's own words about their business. Telling a
     * stranger "that exists but is not yours" confirms the id is real, which is
     * enough to enumerate. The refusal and the absence must be indistinguishable.
     */
    await expect(
      aiConversations.getConversation(id, { organizationId: ORG_B, userId: USER_B }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);

    // Nor to an anonymous caller holding some other cookie, which is the second
    // ownership dimension the same check arbitrates.
    await expect(
      aiConversations.getConversation(id, { anonymousKey: "some-other-cookie" }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });

  /*
   * The other side of the same check, and the more expensive one to have missed.
   *
   * `assertCanRead` refuses a conversation with no `userId`, no `organizationId`
   * and no `anonymousKey` — correctly, since there is no credential that could
   * ever match. But `startOrResume` used to *write* exactly that whenever it was
   * called without an owner, which the assistant pages did on every visit that
   * arrived without a cookie. The author of the conversation could not read it
   * back: their first message returned "No such conversation."
   *
   * Nine such rows existed, every one with zero messages. Refusing at the write
   * is what stops a fix upstream from silently regressing.
   */
  it("refuses to create a conversation nobody could ever read", async () => {
    await expect(
      aiConversations.startOrResume({ contextType: "custom_build" }),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    // An anonymous key alone is a real owner, and must still work — this is the
    // signed-out visitor the guard exists to protect, not to block.
    await expect(
      aiConversations.startOrResume({
        contextType: "custom_build",
        anonymousKey: "cold-visitor-cookie",
      }),
    ).resolves.toBeTruthy();
  });
});
