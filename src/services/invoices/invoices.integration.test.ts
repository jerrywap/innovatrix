import { afterAll, afterEach, beforeAll, describe, expect, it, vi, inject } from "vitest";
import { VALID_ENV } from "@/test/env";

/**
 * §63, §52, §61 — the invoice.
 *
 * The guarantees here are all about money not moving on its own: a total that
 * cannot drift from the quote it came from, a payment that cannot exceed the
 * balance, and two payments that cannot overwrite each other.
 */

let mongoose: typeof import("mongoose").default;
let service: typeof import("./invoice-service");
let quotes: typeof import("@/services/quotes/quote-service");
let events: typeof import("@/lib/events");
let billing: typeof import("@/lib/db/models/billing");
let requests: typeof import("@/lib/db/models/requests");
let errors: typeof import("@/lib/errors");
let invoiceView: typeof import("@/features/invoices/invoice-view");
let paymentService: typeof import("@/services/payments/payment-service");

const ORG = "6a80c46f6c887b38e2f0e0b4";
const CUSTOMER = "6a80c46f6c887b38e2f0e0b2";
const STAFF = "6a80c46f6c887b38e2f0e0a1";

const SYSTEM = { type: "system" } as const;
const ISSUER = { userId: STAFF, name: "Sam", permissions: new Set(["quote.issue"]) };
const BUYER = { userId: CUSTOMER, organizationId: ORG, name: "Amara" };

beforeAll(async () => {
  vi.resetModules();
  for (const [key, value] of Object.entries(VALID_ENV)) vi.stubEnv(key, value);
  vi.stubEnv("MONGODB_URI", inject("mongoUri"));
  vi.stubEnv("MONGODB_DB_NAME", "invoices_test");
  vi.stubEnv("MONGODB_TRANSACTIONS", "true");

  mongoose = (await import("mongoose")).default;
  service = await import("./invoice-service");
  quotes = await import("@/services/quotes/quote-service");
  events = await import("@/lib/events");
  billing = await import("@/lib/db/models/billing");
  requests = await import("@/lib/db/models/requests");
  errors = await import("@/lib/errors");
  /*
   * Imported here, not inside the test that uses them.
   *
   * `payment-service` pulls in the provider registry and its three drivers, and
   * transforming that graph cold took longer than the test's own timeout when
   * the full suite had four mongods competing for CPU. `beforeAll` has a 180s
   * allowance and module loading is not what that test is measuring.
   */
  invoiceView = await import("@/features/invoices/invoice-view");
  paymentService = await import("@/services/payments/payment-service");

  const { connectToDatabase } = await import("@/lib/db/client");
  await connectToDatabase();
  await Promise.all([
    billing.Quote.syncIndexes(),
    billing.Invoice.syncIndexes(),
    requests.CustomerRequest.syncIndexes(),
  ]);
}, 180_000);

afterAll(async () => {
  vi.unstubAllEnvs();
  await mongoose?.disconnect();
});

afterEach(async () => {
  events.resetBus();
  await Promise.all([
    billing.Quote.deleteMany({}),
    billing.Invoice.deleteMany({}),
    requests.CustomerRequest.deleteMany({}),
    mongoose.connection.collection("auditLogs").deleteMany({}),
    mongoose.connection.collection("activityEvents").deleteMany({}),
    mongoose.connection.collection("counters").deleteMany({}),
  ]);
});

/* ────────────────────────────────────────────── fixtures */

/** An accepted quote. `deposit` ⇒ 50% deposit terms. */
async function acceptedQuote(options: { deposit?: boolean } = {}) {
  const request = await requests.CustomerRequest.create({
    reference: `REQ-2026-${String(Math.floor(Math.random() * 9000) + 1000)}`,
    kind: "custom_build",
    organizationId: new mongoose.Types.ObjectId(ORG),
    userId: new mongoose.Types.ObjectId(CUSTOMER),
    title: "Rota system",
    customerRequirements: [],
    assumptions: [],
    status: "under_review",
  });

  const draft = await quotes.createDraft(
    {
      requestId: String(request._id),
      organizationId: ORG,
      title: "Rota system",
      deliverables: ["Scheduling"],
      exclusions: [],
      currency: "GBP",
      items: [
        {
          kind: "development",
          description: "Build",
          quantity: 1,
          unitPriceAmount: 1_000_000,
        },
      ],
      taxBasisPoints: 0,
      paymentTerms: options.deposit ? "deposit_balance" : "full_upfront",
      ...(options.deposit ? { depositBasisPoints: 5000 } : {}),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
    ISSUER,
  );

  await quotes.issue(String(draft._id), ISSUER);
  return quotes.accept(String(draft._id), BUYER);
}

/* ────────────────────────────────────────────── tests */

describe("an accepted quote becomes an invoice — §52", () => {
  it("copies the lines and the total exactly", async () => {
    const quote = await acceptedQuote();
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);

    expect(invoices).toHaveLength(1);
    const invoice = invoices[0]!;

    expect(invoice.reference).toMatch(/^INV-\d{4}-\d{4}$/);
    expect(invoice.total.amount).toBe(quote.total.amount);
    expect(invoice.items).toHaveLength(quote.items.length);
    expect(invoice.items[0]!.lineTotal.amount).toBe(quote.items[0]!.lineTotal.amount);
    expect(invoice.status).toBe("issued");
    expect(invoice.portion).toBe("full");
  });

  it("keeps its figures when the quote is later superseded — §61", async () => {
    // The criterion: "invoice line totals equal the accepted quote's, forever".
    const quote = await acceptedQuote();
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);

    // Simulate the quote being changed underneath — the thing the snapshot
    // exists to survive.
    await billing.Quote.updateOne(
      { _id: quote._id },
      { $set: { "total.amount": 1, "items.0.lineTotal.amount": 1 } },
    );

    const stored = await billing.Invoice.findById(invoices[0]!._id).lean();
    expect(stored!.total.amount).toBe(1_000_000);
    expect(stored!.items[0]!.lineTotal.amount).toBe(1_000_000);
  });

  it("creates exactly one deposit invoice for 50% terms, not two", async () => {
    /*
     * §63 wants a deposit now and a balance on completion. Raising both up
     * front would put a balance invoice in the customer's overdue queue for
     * work that has not started.
     */
    const quote = await acceptedQuote({ deposit: true });
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);

    expect(invoices).toHaveLength(1);
    expect(invoices[0]!.portion).toBe("deposit");
    expect(invoices[0]!.total.amount).toBe(500_000);
    // The lines are still the whole job — a "50% deposit" line would lose what
    // the money is for.
    expect(invoices[0]!.items[0]!.lineTotal.amount).toBe(1_000_000);
  });

  it("raises the balance separately, and only once", async () => {
    const quote = await acceptedQuote({ deposit: true });
    await service.createFromQuote(String(quote._id), SYSTEM);

    const balance = await service.raiseBalance(String(quote._id), SYSTEM);
    const again = await service.raiseBalance(String(quote._id), SYSTEM);

    expect(balance.total.amount).toBe(500_000);
    expect(String(again._id)).toBe(String(balance._id));
    expect(await billing.Invoice.countDocuments({})).toBe(2);
  });

  it("is idempotent, so a re-emitted event does not bill twice", async () => {
    const quote = await acceptedQuote();
    const first = await service.createFromQuote(String(quote._id), SYSTEM);
    const second = await service.createFromQuote(String(quote._id), SYSTEM);

    expect(String(second.invoices[0]!._id)).toBe(String(first.invoices[0]!._id));
    expect(await billing.Invoice.countDocuments({})).toBe(1);
  });

  it("refuses a quote that has not been accepted", async () => {
    const request = await requests.CustomerRequest.create({
      reference: "REQ-2026-7777",
      kind: "custom_build",
      organizationId: new mongoose.Types.ObjectId(ORG),
      userId: new mongoose.Types.ObjectId(CUSTOMER),
      title: "Not agreed",
      customerRequirements: [],
      assumptions: [],
      status: "under_review",
    });
    const draft = await quotes.createDraft(
      {
        requestId: String(request._id),
        organizationId: ORG,
        title: "Draft",
        deliverables: [],
        exclusions: [],
        currency: "GBP",
        items: [{ kind: "service", description: "x", quantity: 1, unitPriceAmount: 1000 }],
        paymentTerms: "full_upfront",
        expiresAt: new Date(Date.now() + 86_400_000),
      },
      ISSUER,
    );

    await expect(service.createFromQuote(String(draft._id), SYSTEM)).rejects.toBeInstanceOf(
      errors.ValidationError,
    );
  });
});

describe("payments — §63", () => {
  async function invoiced() {
    const quote = await acceptedQuote();
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);
    return invoices[0]!;
  }

  it("two partial payments totalling the invoice produce paid, not partially_paid", async () => {
    const invoice = await invoiced();

    const first = await service.applyPayment(
      {
        invoiceId: String(invoice._id),
        amount: 400_000,
        currency: "GBP",
        paymentReference: "PAY-1",
      },
      SYSTEM,
    );
    expect(first.outcome).toBe("partially_paid");

    const second = await service.applyPayment(
      {
        invoiceId: String(invoice._id),
        amount: 600_000,
        currency: "GBP",
        paymentReference: "PAY-2",
      },
      SYSTEM,
    );

    expect(second.outcome).toBe("paid");
    expect(second.invoice.amountPaid.amount).toBe(1_000_000);
    expect(second.invoice.paidAt).toBeInstanceOf(Date);
  });

  it("refuses an overpayment rather than banking it", async () => {
    // An explicit criterion. A duplicate or a typo needs a person, and an
    // invoice reading "£1,200 paid of £1,000" reconciles against nothing.
    const invoice = await invoiced();

    await expect(
      service.applyPayment(
        {
          invoiceId: String(invoice._id),
          amount: 1_200_000,
          currency: "GBP",
          paymentReference: "PAY-X",
        },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);

    const stored = await billing.Invoice.findById(invoice._id).lean();
    expect(stored!.amountPaid.amount).toBe(0);
    expect(stored!.status).toBe("issued");
  });

  it("refuses a payment in the wrong currency", async () => {
    const invoice = await invoiced();
    await expect(
      service.applyPayment(
        {
          invoiceId: String(invoice._id),
          amount: 1000,
          currency: "USD",
          paymentReference: "P",
        },
        SYSTEM,
      ),
    ).rejects.toBeInstanceOf(errors.ValidationError);
  });

  it("does not let two concurrent payments overwrite each other", async () => {
    /*
     * Both would read `amountPaid: 0`, both compute a new total from it, and
     * the second write would erase the first. The guard is on the figure that
     * was read, so one of them loses and says so.
     */
    const invoice = await invoiced();

    const results = await Promise.allSettled([
      service.applyPayment(
        {
          invoiceId: String(invoice._id),
          amount: 300_000,
          currency: "GBP",
          paymentReference: "A",
        },
        SYSTEM,
      ),
      service.applyPayment(
        {
          invoiceId: String(invoice._id),
          amount: 300_000,
          currency: "GBP",
          paymentReference: "B",
        },
        SYSTEM,
      ),
    ]);

    const stored = await billing.Invoice.findById(invoice._id).lean();
    const succeeded = results.filter((r) => r.status === "fulfilled").length;

    // Whatever the interleaving, the recorded total is the sum of what actually
    // succeeded — never one payment's worth for two.
    expect(stored!.amountPaid.amount).toBe(succeeded * 300_000);
  });

  it("emits InvoicePaid only on full settlement — §52's work-order seam", async () => {
    const seen: unknown[] = [];
    events.on("InvoicePaid", (payload) => {
      seen.push(payload);
    });

    const invoice = await invoiced();

    await service.applyPayment(
      {
        invoiceId: String(invoice._id),
        amount: 400_000,
        currency: "GBP",
        paymentReference: "1",
      },
      SYSTEM,
    );
    expect(seen).toHaveLength(0);

    await service.applyPayment(
      {
        invoiceId: String(invoice._id),
        amount: 600_000,
        currency: "GBP",
        paymentReference: "2",
      },
      SYSTEM,
    );
    expect(seen).toHaveLength(1);
  });

  it("audits every payment with the reference and the before and after", async () => {
    const invoice = await invoiced();
    await service.applyPayment(
      {
        invoiceId: String(invoice._id),
        amount: 1_000_000,
        currency: "GBP",
        paymentReference: "PAY-9",
      },
      SYSTEM,
    );

    const audit = await mongoose.connection
      .collection("auditLogs")
      .findOne({ action: "invoice.payment_applied" });

    expect(audit!.before).toMatchObject({ amountPaid: 0, status: "issued" });
    expect(audit!.after).toMatchObject({ amountPaid: 1_000_000, status: "paid" });
  });
});

describe("full payment converts the request — §52", () => {
  it("moves the request to converted and emits WorkReadyToStart", async () => {
    const handlers = await import("./handlers");
    handlers.registerInvoiceHandlers();

    const seen: unknown[] = [];
    events.on("WorkReadyToStart", (payload) => {
      seen.push(payload);
    });

    const quote = await acceptedQuote();
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);

    await service.applyPayment(
      {
        invoiceId: String(invoices[0]!._id),
        amount: 1_000_000,
        currency: "GBP",
        paymentReference: "PAY-1",
      },
      SYSTEM,
    );

    const request = await requests.CustomerRequest.findById(quote.requestId).lean<{
      status: string;
    }>();

    expect(request!.status).toBe("converted");
    expect(seen).toHaveLength(1);
  });

  it("converts on the deposit, and the balance does not convert again", async () => {
    /*
     * The point of the whole arrangement: work starts when the deposit clears.
     * The balance lands on a finished job and must do nothing — a second
     * `WorkReadyToStart` would have ticket 53 open the work twice.
     */
    const handlers = await import("./handlers");
    handlers.registerInvoiceHandlers();

    const seen: unknown[] = [];
    events.on("WorkReadyToStart", (payload) => {
      seen.push(payload);
    });

    const quote = await acceptedQuote({ deposit: true });
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);

    await service.applyPayment(
      {
        invoiceId: String(invoices[0]!._id),
        amount: 500_000,
        currency: "GBP",
        paymentReference: "DEP",
      },
      SYSTEM,
    );
    expect(seen).toHaveLength(1);

    const balance = await service.raiseBalance(String(quote._id), SYSTEM);
    await service.applyPayment(
      {
        invoiceId: String(balance._id),
        amount: 500_000,
        currency: "GBP",
        paymentReference: "BAL",
      },
      SYSTEM,
    );

    expect(seen).toHaveLength(1);
  });
});

describe("organization scope", () => {
  it("hides an invoice from another organization, and from its Pay Now", async () => {
    const { loadInvoice } = invoiceView;

    const quote = await acceptedQuote();
    const { invoices } = await service.createFromQuote(String(quote._id), SYSTEM);
    const id = String(invoices[0]!._id);

    const stranger = "6a80c46f6c887b38e2f0e0ff";

    expect(await loadInvoice(id, { organizationId: ORG })).not.toBeNull();
    // Not a filtered-down view — nothing at all, so there is no reference, no
    // total and no existence to infer.
    expect(await loadInvoice(id, { organizationId: stranger })).toBeNull();

    // The same scope on the way in: `initiatePaymentForInvoice` filters on the
    // session's organisation, so a stranger's id is a 404 rather than a
    // payment page for somebody else's bill.
    const { initiatePaymentForInvoice } = paymentService;

    await expect(
      initiatePaymentForInvoice({
        invoiceId: id,
        organizationId: stranger,
        customerEmail: "nobody@example.test",
        actor: SYSTEM,
      }),
    ).rejects.toBeInstanceOf(errors.NotFoundError);
  });
});

describe("outstanding", () => {
  it("never goes negative", async () => {
    expect(
      service.outstanding({
        total: { amount: 1000, currency: "GBP" },
        amountPaid: { amount: 1500, currency: "GBP" },
      }),
    ).toBe(0);
  });
});
