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

/** Org A owns everything. Org B is authenticated and is the attacker. */
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

  await catalog.Product.create({
    _id: PRODUCT,
    name: "Atlas",
    slug: "atlas",
    summary: "Alpha's product",
    status: "published",
    prices: [MONEY],
    currentVersionId: VERSION,
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
});
