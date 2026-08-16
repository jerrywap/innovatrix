import "server-only";
import type { Types } from "mongoose";
import { Invoice, Quote } from "@/lib/db/models/billing";
import { emit } from "@/lib/events";
import { defineJob } from "../registry";

/**
 * The billing sweeps — §68's reminders, §63's overdue state, §51's expiry.
 *
 * ## Why these are jobs and nothing else in billing is
 *
 * Every other billing state change has a cause: somebody accepted, somebody
 * paid, somebody cancelled. These three have no cause at all — an invoice does
 * not become overdue because anything *happened*, it becomes overdue because
 * time passed. There is no request to hang the transition off, which is exactly
 * why they need a scheduler.
 *
 * ## Every one of them is idempotent
 *
 * "Running twice in a day changes nothing extra" is an acceptance criterion,
 * and it is not free: each sweep either narrows its filter to rows it has not
 * already handled (`status: "issued"` → `overdue` cannot match twice) or records
 * what it did (`remindersSentAt`). The notification layer's dedupe key is a
 * second net under both, but relying on it alone would mean a sweep that
 * hammers the same rows every hour and only *looks* idempotent.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far ahead §68's "before due" reminder looks. */
const DUE_SOON_DAYS = [3, 0] as const;

/** Chase an overdue invoice on these days past due, and then stop. */
const OVERDUE_REMINDER_DAYS = [1, 7, 14, 30] as const;

/** No sweep touches more than this in one run (§94). */
const BATCH = 200;

export function registerBillingJobs(): void {
  /**
   * `issued` invoices whose due date has passed → `overdue`.
   *
   * The read-side `effectiveStatus` in `invoice-view.ts` **stays**. It derives
   * the same answer from `dueAt` on every read, so a customer looking at an
   * invoice between midnight and the sweep sees the truth rather than a stale
   * badge. This job makes the stored status agree, which is what the staff list
   * filters on and what `/admin` counts.
   */
  defineJob("mark-invoices-overdue", async () => {
    const now = new Date();

    const result = await Invoice.updateMany(
      {
        // `partially_paid` too: a deposit paid against a balance still owing
        // past its date is overdue, and INVOICE_TRANSITIONS allows it.
        status: { $in: ["issued", "partially_paid"] },
        dueAt: { $lte: now },
        $expr: { $lt: ["$amountPaid.amount", "$total.amount"] },
      },
      { $set: { status: "overdue" } },
    );

    if (result.modifiedCount > 0) {
      console.info(`[jobs] mark-invoices-overdue: ${result.modifiedCount} invoice(s)`);
    }
  });

  /**
   * `issued` quotes past `expiresAt` → `expired`.
   *
   * `quote-service.ts` keeps its own check at the point of acceptance. That is
   * not redundancy to tidy away later: between the expiry passing and this
   * sweep running there is a window in which the stored status still says
   * `issued`, and the acceptance path is the one place where being wrong costs
   * money. The sweep narrows the window; the guard closes it.
   */
  defineJob("expire-quotes", async () => {
    const now = new Date();

    const result = await Quote.updateMany(
      { status: "issued", expiresAt: { $lte: now } },
      { $set: { status: "expired" } },
    );

    if (result.modifiedCount > 0) {
      console.info(`[jobs] expire-quotes: ${result.modifiedCount} quote(s)`);
    }
  });

  /**
   * Dunning — §68.
   *
   * `remindersSentAt` is the ledger. Without it a daily sweep would re-send
   * every reminder every day, and the dedupe key on the notification would hide
   * that by silently dropping them — a queue full of work that produces nothing,
   * which is worse than a duplicate because nobody would ever notice.
   */
  defineJob("send-invoice-reminders", async () => {
    const now = Date.now();

    const invoices = await Invoice.find({
      status: { $in: ["issued", "partially_paid", "overdue"] },
      dueAt: { $exists: true },
      $expr: { $lt: ["$amountPaid.amount", "$total.amount"] },
    })
      .select({
        reference: 1,
        organizationId: 1,
        dueAt: 1,
        total: 1,
        amountPaid: 1,
        currency: 1,
        remindersSentAt: 1,
      })
      .limit(BATCH)
      .lean<
        {
          _id: Types.ObjectId;
          reference: string;
          organizationId: Types.ObjectId;
          dueAt: Date;
          total: { amount: number };
          amountPaid: { amount: number };
          currency: string;
          remindersSentAt: Date[];
        }[]
      >();

    for (const invoice of invoices) {
      const dueAt = new Date(invoice.dueAt).getTime();
      // Whole days, floored towards the past: an invoice due at 09:00 is "due
      // today" all day rather than becoming overdue at 09:01.
      const daysOverdue = Math.floor((now - dueAt) / DAY_MS);
      const outstanding = invoice.total.amount - invoice.amountPaid.amount;

      const stage = stageFor(daysOverdue);
      if (stage === null) continue;

      // One reminder per calendar day, whatever else runs.
      const alreadyToday = invoice.remindersSentAt.some(
        (sent) => Math.floor((now - new Date(sent).getTime()) / DAY_MS) === 0,
      );
      if (alreadyToday) continue;

      const context = {
        organizationId: String(invoice.organizationId),
      };

      if (daysOverdue > 0) {
        await emit("InvoiceOverdue", {
          invoiceId: String(invoice._id),
          reference: invoice.reference,
          ...context,
          daysOverdue,
          outstanding,
          currency: invoice.currency,
        });
      } else {
        await emit("InvoiceDueSoon", {
          invoiceId: String(invoice._id),
          reference: invoice.reference,
          ...context,
          daysUntilDue: -daysOverdue,
          outstanding,
          currency: invoice.currency,
        });
      }

      await Invoice.updateOne(
        { _id: invoice._id as Types.ObjectId },
        { $push: { remindersSentAt: new Date() } },
      );
    }
  });
}

/**
 * Which reminder, if any, today's run should send.
 *
 * A fixed schedule rather than "every day until paid". Daily chasing trains a
 * customer to filter the sender, and after thirty days the problem is a
 * conversation rather than another email — which is why the ladder ends.
 */
function stageFor(daysOverdue: number): "due_soon" | "overdue" | null {
  if (daysOverdue > 0) {
    return OVERDUE_REMINDER_DAYS.includes(daysOverdue as (typeof OVERDUE_REMINDER_DAYS)[number])
      ? "overdue"
      : null;
  }

  const daysUntilDue = -daysOverdue;
  return DUE_SOON_DAYS.includes(daysUntilDue as (typeof DUE_SOON_DAYS)[number])
    ? "due_soon"
    : null;
}
