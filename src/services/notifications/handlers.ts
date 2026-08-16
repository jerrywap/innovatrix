import "server-only";
import { on, type DomainEventName } from "@/lib/events";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { CustomerRequest } from "@/lib/db/models/requests";
import { CATALOG } from "./catalog";
import { dispatch } from "./notification-service";
import { registerNotificationChannels } from "./drivers";
import { messageSender } from "./recipients";

/**
 * Every event in §69's table, subscribed once — ticket 24.
 *
 * ## The handler's whole job is to supply context the payload lacks
 *
 * `dispatch` resolves audiences, but "the assignee" and "the owner" are not in
 * an event payload — an event says what happened, not who to tell. So each
 * handler below looks up only the ids its audiences need, and everything else
 * is table-driven.
 *
 * Handlers with nothing to look up are registered generically from `CATALOG`,
 * which is what keeps the mapping in one readable file rather than fifteen
 * near-identical functions.
 */

/** Events whose audiences need nothing beyond the organisation. */
const GENERIC: DomainEventName[] = [
  "QuoteIssued",
  "QuoteAccepted",
  "QuoteRejected",
  "InvoiceIssued",
  "InvoicePaid",
  "InvoiceDueSoon",
  "InvoiceOverdue",
  "WorkReadyToStart",
];

export function registerNotificationHandlers(): void {
  registerNotificationChannels();

  for (const event of GENERIC) {
    if (!CATALOG[event]) continue;
    on(event, async (payload) => {
      await dispatch(event, payload as never, {
        organizationId: (payload as { organizationId?: string }).organizationId,
      });
    });
  }

  /* ── the ones that need a lookup ─────────────────────── */

  on("RequestSubmitted", async (payload) => {
    await dispatch("RequestSubmitted", payload, {
      organizationId: payload.organizationId,
      ...(await requestOwner(payload.requestId)),
    });
  });

  on("CustomizationSubmitted", async (payload) => {
    await dispatch("CustomizationSubmitted", payload, {
      organizationId: payload.organizationId,
      ...(await requestOwner(payload.requestId)),
    });
  });

  on("RequestAssigned", async (payload) => {
    await dispatch("RequestAssigned", payload, {
      organizationId: payload.organizationId,
      assigneeUserId: payload.assigneeUserId,
      // Assigning something to yourself should not send you a note about it.
      ...(payload.assignedByUserId ? { actorUserId: payload.assignedByUserId } : {}),
    });
  });

  on("CustomerActionRequested", async (payload) => {
    await dispatch("CustomerActionRequested", payload, {
      organizationId: payload.organizationId,
    });
  });

  on("MessagePosted", async (payload) => {
    await dispatch("MessagePosted", payload, {
      organizationId: payload.organizationId,
      conversationId: payload.conversationId,
      // §37 in the audience, not in the template: an internal note resolves to
      // staff participants only, so a customer never appears in the list.
      messageAudience: payload.audience,
      actorUserId: payload.senderUserId || (await messageSender(payload.messageId)),
    });
  });

  on("ProductVersionReleased", async (payload) => {
    await dispatch("ProductVersionReleased", payload, { productId: payload.productId });
  });

  /*
   * A follow-up is a private note-to-self (§39), so the audience is the one
   * person who set it. `assignee` is the audience kind that reads a single
   * staff user id out of the context, which is exactly the shape needed —
   * mapping `ownerUserId` onto it here rather than adding a fifth audience
   * that would resolve identically.
   */
  on("FollowUpDue", async (payload) => {
    await dispatch("FollowUpDue", payload, { assigneeUserId: payload.ownerUserId });
  });
}

/**
 * Who raised the request.
 *
 * `userId` on the request rather than the event, because the event is about the
 * request moving and the person who raised it is a property of the record. It
 * also survives a staff member submitting on a customer's behalf, where the
 * actor and the owner are different people.
 */
async function requestOwner(requestId: string): Promise<{ ownerUserId?: string }> {
  await connectToDatabase();

  const request = await CustomerRequest.findById(toObjectId(requestId))
    .select({ userId: 1 })
    .lean<{ userId: unknown }>();

  return request ? { ownerUserId: String(request.userId) } : {};
}
