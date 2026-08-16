import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { counterStore } from "@/lib/db/counter-store";
import type { PaymentTerms, QuoteItemKind } from "@/lib/db/enums";
import { Quote, type QuoteDoc, type QuoteItem } from "@/lib/db/models/billing";
import { ActivityEvent } from "@/lib/db/models/communication";
import { CustomerRequest } from "@/lib/db/models/requests";
import { assertTransition, QUOTE_TRANSITIONS } from "@/lib/db/states";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateReference } from "@/lib/references";
import { withTransaction } from "@/lib/db/transaction";
import { emit } from "@/lib/events";
import { staffActor, writeAuditLog, type AuditActor } from "@/services/audit";
import { transition as transitionRequest } from "@/services/requests/request-service";
import { computeTotals, lineTotal } from "./totals";

/**
 * Quotes — §51, §52, §90.
 *
 * The last purely-human judgement step before money moves. §73 forbids the AI
 * from pricing anything, so everything here is staff-authored and every
 * material event is audited: **acceptance is a contract event and must be
 * reconstructable months later.**
 *
 * ## A quote is never edited once issued
 *
 * `QUOTE_TRANSITIONS` already makes `accepted` terminal and routes changes
 * through `superseded`. Revising creates **version 2** pointing at v1 rather
 * than mutating it, so "what did I agree to?" always has an answer — and it is
 * also what makes storing a rendered PDF unnecessary: the data behind a version
 * cannot change, so re-rendering it always produces the same document.
 */

export interface DraftInput {
  requestId: string;
  organizationId: string;
  title: string;
  scope?: string;
  deliverables: string[];
  exclusions: string[];
  notes?: string;
  currency: string;
  items: Array<{
    kind: QuoteItemKind;
    description: string;
    quantity: number;
    unitPriceAmount: number;
  }>;
  discountAmount?: number;
  taxBasisPoints?: number;
  paymentTerms: PaymentTerms;
  depositBasisPoints?: number;
  estimatedStart?: Date;
  estimatedDurationDays?: number;
  expiresAt: Date;
}

function priced(input: DraftInput): {
  items: QuoteItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
} {
  const items: QuoteItem[] = input.items.map((item) => ({
    kind: item.kind,
    description: item.description,
    quantity: item.quantity,
    unitPrice: { amount: item.unitPriceAmount, currency: input.currency },
    lineTotal: {
      amount: lineTotal({
        quantity: item.quantity,
        unitPrice: { amount: item.unitPriceAmount, currency: input.currency },
      }),
      currency: input.currency,
    },
  }));

  const totals = computeTotals({
    items,
    ...(input.discountAmount ? { discountAmount: input.discountAmount } : {}),
    ...(input.taxBasisPoints ? { taxBasisPoints: input.taxBasisPoints } : {}),
  });

  return { items, ...totals };
}

/* ────────────────────────────────────────────── drafting */

export async function createDraft(
  input: DraftInput,
  actor: { userId: string; name?: string },
): Promise<QuoteDoc> {
  await connectToDatabase();

  const request = await CustomerRequest.findOne({
    _id: toObjectId(input.requestId),
    organizationId: toObjectId(input.organizationId),
  }).lean<{ _id: unknown }>();
  if (!request) throw new NotFoundError("request", { id: input.requestId });

  const { items, subtotal, discount, tax, total } = priced(input);

  const created = await withTransaction(async (session) => {
    // The counter joins the transaction, so a rolled-back draft burns no
    // reference — the same fix orders and requests needed.
    const reference = await generateReference(counterStore(session), "QUO");

    const [quote] = await Quote.create(
      [
        {
          reference,
          version: 1,
          organizationId: toObjectId(input.organizationId),
          requestId: toObjectId(input.requestId),
          title: input.title,
          ...(input.scope ? { scope: input.scope } : {}),
          deliverables: input.deliverables,
          exclusions: input.exclusions,
          ...(input.notes ? { notes: input.notes } : {}),
          items,
          currency: input.currency,
          subtotal: { amount: subtotal, currency: input.currency },
          ...(discount ? { discount: { amount: discount, currency: input.currency } } : {}),
          ...(tax
            ? {
                tax: {
                  basisPoints: input.taxBasisPoints,
                  amount: tax,
                  currency: input.currency,
                },
              }
            : {}),
          total: { amount: total, currency: input.currency },
          paymentTerms: input.paymentTerms,
          ...(input.depositBasisPoints ? { depositBasisPoints: input.depositBasisPoints } : {}),
          ...(input.estimatedStart ? { estimatedStart: input.estimatedStart } : {}),
          ...(input.estimatedDurationDays
            ? { estimatedDurationDays: input.estimatedDurationDays }
            : {}),
          expiresAt: input.expiresAt,
          status: "draft",
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: "quote.drafted",
        actor: staffActor({ id: actor.userId, ...(actor.name ? { name: actor.name } : {}) }),
        subject: { type: "quote", id: String(quote!._id) },
        organizationId: input.organizationId,
        after: { reference, total, currency: input.currency },
      },
      session,
    );

    return quote!.toObject() as QuoteDoc;
  });

  return created;
}

/* ────────────────────────────────────────────── issuing */

/**
 * Send it to the customer.
 *
 * ## What cannot be issued
 *
 * No line items, no total, or an expiry already in the past. §51's criterion
 * covers the first two; the third is the one that bites in practice — a quote
 * issued with yesterday's date is unacceptable the moment it arrives, and the
 * customer discovers that rather than the sender.
 */
export async function issue(
  quoteId: string,
  actor: { userId: string; name?: string; permissions: ReadonlySet<string> },
): Promise<QuoteDoc> {
  if (!actor.permissions.has("quote.issue")) {
    throw new ForbiddenError("You can draft a quote, but not issue one.");
  }

  await connectToDatabase();
  const quote = await Quote.findById(toObjectId(quoteId)).lean<QuoteDoc>();
  if (!quote) throw new NotFoundError("quote", { id: quoteId });

  assertTransition("quote", QUOTE_TRANSITIONS, quote.status, "issued");

  if (quote.items.length === 0) {
    throw new ValidationError("A quote needs at least one line before it can go out.", {
      items: ["Add a line item."],
    });
  }
  if (quote.total.amount <= 0) {
    throw new ValidationError("A quote needs a total above zero.", {
      items: ["The total is zero."],
    });
  }
  if (quote.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError("That expiry date has already passed.", {
      expiresAt: ["Pick a date in the future."],
    });
  }

  const issued = await withTransaction(async (session) => {
    const result = await Quote.findOneAndUpdate(
      { _id: quote._id, status: "draft" },
      {
        $set: {
          status: "issued",
          issuedAt: new Date(),
          issuedByUserId: toObjectId(actor.userId),
        },
      },
      { returnDocument: "after", session },
    ).lean<QuoteDoc>();

    if (!result) throw new ValidationError("That quote has already been issued.", {});

    await ActivityEvent.create(
      [
        {
          organizationId: result.organizationId,
          subjectType: "quote",
          subjectId: result._id,
          type: "QuoteIssued",
          message: `Quote ${result.reference} is ready for you`,
          actorType: "staff",
          actorUserId: toObjectId(actor.userId),
          ...(actor.name ? { actorName: actor.name } : {}),
          visibility: "customer",
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: "quote.issued",
        actor: staffActor({ id: actor.userId, ...(actor.name ? { name: actor.name } : {}) }),
        subject: { type: "quote", id: String(result._id) },
        organizationId: String(result.organizationId),
        after: {
          reference: result.reference,
          version: result.version,
          total: result.total.amount,
          currency: result.currency,
        },
      },
      session,
    );

    return result;
  });

  // The request follows the quote, not the other way round. Best-effort: a
  // request already past `quoted` should not block a quote going out.
  await transitionRequest({
    requestId: String(issued.requestId),
    to: "quoted",
    actor: {
      type: "staff",
      userId: actor.userId,
      ...(actor.name ? { name: actor.name } : {}),
      permissions: actor.permissions,
    },
  }).catch(() => {});

  await emit("QuoteIssued", {
    quoteId: String(issued._id),
    reference: issued.reference,
    organizationId: String(issued.organizationId),
    requestId: String(issued.requestId),
    total: issued.total.amount,
    currency: issued.currency,
  });

  return issued;
}

/* ────────────────────────────────────────────── revising */

/**
 * A revision is a new version, never an edit.
 *
 * §51: the customer sees the current version and can view prior ones. Editing
 * in place would destroy the record of what was on the table when they were
 * thinking about it, which is exactly the thing a dispute turns on.
 */
export async function revise(
  quoteId: string,
  input: Omit<DraftInput, "requestId" | "organizationId">,
  actor: { userId: string; name?: string; permissions: ReadonlySet<string> },
): Promise<QuoteDoc> {
  await connectToDatabase();

  const previous = await Quote.findById(toObjectId(quoteId)).lean<QuoteDoc>();
  if (!previous) throw new NotFoundError("quote", { id: quoteId });

  assertTransition("quote", QUOTE_TRANSITIONS, previous.status, "superseded");

  const { items, subtotal, discount, tax, total } = priced({
    ...input,
    requestId: String(previous.requestId),
    organizationId: String(previous.organizationId),
  });

  return withTransaction(async (session) => {
    const [next] = await Quote.create(
      [
        {
          // Same reference, next version. A customer talking about "quote
          // QUO-2026-0004" means the thing, not one revision of it.
          reference: previous.reference,
          version: previous.version + 1,
          supersedesQuoteId: previous._id,
          organizationId: previous.organizationId,
          requestId: previous.requestId,
          title: input.title,
          ...(input.scope ? { scope: input.scope } : {}),
          deliverables: input.deliverables,
          exclusions: input.exclusions,
          ...(input.notes ? { notes: input.notes } : {}),
          items,
          currency: input.currency,
          subtotal: { amount: subtotal, currency: input.currency },
          ...(discount ? { discount: { amount: discount, currency: input.currency } } : {}),
          ...(tax
            ? {
                tax: {
                  basisPoints: input.taxBasisPoints,
                  amount: tax,
                  currency: input.currency,
                },
              }
            : {}),
          total: { amount: total, currency: input.currency },
          paymentTerms: input.paymentTerms,
          ...(input.depositBasisPoints ? { depositBasisPoints: input.depositBasisPoints } : {}),
          expiresAt: input.expiresAt,
          status: "draft",
        },
      ],
      { session },
    );

    await Quote.updateOne(
      { _id: previous._id },
      { $set: { status: "superseded" } },
      { session },
    );

    await writeAuditLog(
      {
        action: "quote.revised",
        actor: staffActor({ id: actor.userId, ...(actor.name ? { name: actor.name } : {}) }),
        subject: { type: "quote", id: String(next!._id) },
        organizationId: String(previous.organizationId),
        before: { version: previous.version, total: previous.total.amount },
        after: { version: next!.version, total },
      },
      session,
    );

    return next!.toObject() as QuoteDoc;
  });
}

/* ────────────────────────────────────────────── the customer's decision */

export interface DecisionActor {
  userId: string;
  organizationId: string;
  name?: string;
  /** §51 — recorded on acceptance, because it is a contract event. */
  ip?: string;
}

export async function accept(quoteId: string, actor: DecisionActor): Promise<QuoteDoc> {
  return decide(quoteId, "accepted", actor);
}

export async function reject(
  quoteId: string,
  actor: DecisionActor,
  reason?: string,
): Promise<QuoteDoc> {
  return decide(quoteId, "rejected", actor, reason);
}

async function decide(
  quoteId: string,
  to: "accepted" | "rejected",
  actor: DecisionActor,
  reason?: string,
): Promise<QuoteDoc> {
  await connectToDatabase();

  const quote = await Quote.findById(toObjectId(quoteId)).lean<QuoteDoc>();
  if (!quote) throw new NotFoundError("quote", { id: quoteId });

  // Scope before anything else — a quote id is not a key to somebody else's.
  if (String(quote.organizationId) !== actor.organizationId) {
    throw new NotFoundError("quote", { id: quoteId });
  }

  /*
   * Expiry is checked here rather than left to the sweep. Ticket 25's job marks
   * quotes expired on a schedule; between the expiry passing and the sweep
   * running, the status still says `issued`. Accepting in that window would
   * create a contract from a quote that had lapsed — so the *date* decides, not
   * the status field.
   */
  if (to === "accepted" && quote.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError("That quote has expired. Ask us for a fresh one.", {
      quote: ["Expired."],
    });
  }

  assertTransition("quote", QUOTE_TRANSITIONS, quote.status, to);

  const decided = await withTransaction(async (session) => {
    const result = await Quote.findOneAndUpdate(
      { _id: quote._id, status: "issued" },
      {
        $set: {
          status: to,
          ...(to === "accepted"
            ? {
                acceptedAt: new Date(),
                acceptedByUserId: toObjectId(actor.userId),
                // The version they agreed to, copied rather than referenced —
                // "reconstructable months later" means not depending on the
                // row still saying what it says today.
                acceptedQuoteVersion: quote.version,
              }
            : {}),
          ...(reason ? { rejectionReason: reason } : {}),
        },
      },
      { returnDocument: "after", session },
    ).lean<QuoteDoc>();

    if (!result) {
      throw new ValidationError("Somebody has already answered this quote.", {});
    }

    await ActivityEvent.create(
      [
        {
          organizationId: result.organizationId,
          subjectType: "quote",
          subjectId: result._id,
          type: to === "accepted" ? "QuoteAccepted" : "QuoteRejected",
          message:
            to === "accepted"
              ? `You accepted quote ${result.reference}`
              : `You declined quote ${result.reference}`,
          actorType: "customer",
          actorUserId: toObjectId(actor.userId),
          ...(actor.name ? { actorName: actor.name } : {}),
          visibility: "customer",
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: to === "accepted" ? "quote.accepted" : "quote.rejected",
        actor: customerActor(actor),
        subject: { type: "quote", id: String(result._id) },
        organizationId: actor.organizationId,
        after: {
          version: result.version,
          total: result.total.amount,
          currency: result.currency,
          ...(reason ? { reason } : {}),
        },
        ...(actor.ip ? { ip: actor.ip } : {}),
      },
      session,
    );

    return result;
  });

  /*
   * The request follows. Accepting moves it to `approved`; declining sends it
   * back to `under_review` so somebody picks it up rather than sitting in
   * `quoted` forever with nothing happening.
   *
   * **A `system` actor, not the customer.** The customer's *decision* triggers
   * this; the platform performs it. Passing the customer failed silently for
   * rejection — `quoted → under_review` is `customerMay: false`, correctly, and
   * the `.catch()` swallowed it — leaving declined requests parked in `quoted`.
   * Acceptance only worked because that edge happens to allow a customer.
   *
   * Modelling it as the system is also the truthful reading: a customer is not
   * exercising `request.update_status`, they answered a question and we reacted.
   */
  await transitionRequest({
    requestId: String(decided.requestId),
    to: to === "accepted" ? "approved" : "under_review",
    actor: { type: "system" },
    note: to === "accepted" ? "You accepted the quote" : "You declined the quote",
  }).catch(() => {});

  await emit(to === "accepted" ? "QuoteAccepted" : "QuoteRejected", {
    quoteId: String(decided._id),
    reference: decided.reference,
    organizationId: String(decided.organizationId),
    requestId: String(decided.requestId),
    version: decided.version,
    total: decided.total.amount,
    currency: decided.currency,
  });

  return decided;
}

function customerActor(actor: DecisionActor): AuditActor {
  return {
    type: "customer",
    userId: actor.userId,
    organizationId: actor.organizationId,
    ...(actor.name ? { name: actor.name } : {}),
  };
}

/** First view, for §51's audit trail. Written once and never overwritten. */
export async function recordFirstView(quoteId: string): Promise<void> {
  await connectToDatabase();
  await Quote.updateOne(
    { _id: toObjectId(quoteId), firstViewedAt: { $exists: false } },
    { $set: { firstViewedAt: new Date() } },
  );
}
