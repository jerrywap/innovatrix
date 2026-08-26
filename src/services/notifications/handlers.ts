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
  // Audience is the buying organisation and nothing else needs looking up.
  "AddonProvisioned",
  "QuoteIssued",
  "QuoteAccepted",
  "QuoteRejected",
  "InvoiceIssued",
  "InvoicePaid",
  "InvoiceDueSoon",
  "InvoiceOverdue",
  "WorkReadyToStart",
  "RequestProgressPosted",
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
   * Vendor tickets 01–03. `VendorApplied` is a permission audience and needs no
   * lookup; the other three resolve a `vendor_member` audience from the payload's
   * `vendorId`.
   */
  on("VendorApplied", async (payload) => {
    await dispatch("VendorApplied", payload, { vendorId: payload.vendorId });
  });

  /*
   * Vendor ticket 14. The routed event resolves a `vendor_member` audience by query from its
   * `vendorId`; the two answers go to a staff permission audience and need no lookup.
   */
  on("CustomizationRoutedToVendor", async (payload) => {
    await dispatch("CustomizationRoutedToVendor", payload, { vendorId: payload.vendorId });
  });

  on("VendorBriefAnswered", async (payload) => {
    await dispatch("VendorBriefAnswered", payload, {});
  });

  on("VendorBriefDeclined", async (payload) => {
    await dispatch("VendorBriefDeclined", payload, {});
  });

  on("VendorVerified", async (payload) => {
    await dispatch("VendorVerified", payload, { vendorId: payload.vendorId });
  });

  on("VendorRejected", async (payload) => {
    await dispatch("VendorRejected", payload, { vendorId: payload.vendorId });
  });

  /*
   * One level, decided. Needs the explicit `on` rather than a place in `GENERIC`
   * because its audience is the vendor's own members, which is a query from
   * `vendorId` rather than a permission.
   */
  on("VendorVerificationDecided", async (payload) => {
    await dispatch("VendorVerificationDecided", payload, { vendorId: payload.vendorId });
  });

  on("VendorSuspended", async (payload) => {
    await dispatch("VendorSuspended", payload, { vendorId: payload.vendorId });
  });

  /*
   * Vendor ticket 13. `DisputeRaised` has two rules — a staff queue audience and the vendor —
   * and `dispatch` fans out to both from one event; the customer side is the thread itself,
   * which they are already reading.
   */
  on("VendorSupportThreadOpened", async (payload) => {
    await dispatch("VendorSupportThreadOpened", payload, { vendorId: payload.vendorId });
  });

  on("DisputeRaised", async (payload) => {
    await dispatch("DisputeRaised", payload, {
      ...(payload.vendorId ? { vendorId: payload.vendorId } : {}),
    });
  });

  on("DisputeResolved", async (payload) => {
    await dispatch("DisputeResolved", payload, {
      ...(payload.vendorId ? { vendorId: payload.vendorId } : {}),
    });
  });

  /*
   * Vendor ticket 12. The offboarding notice resolves its audience from the **product ids** —
   * everybody holding an active entitlement to anything that vendor sold, deduplicated by
   * organisation, so a customer who bought three of their products hears once.
   */
  on("VendorOffboarded", async (payload) => {
    await dispatch("VendorOffboarded", payload, { productIds: payload.productIds });
  });

  on("ProductEmergencyDelisted", async (payload) => {
    await dispatch("ProductEmergencyDelisted", payload, {});
  });

  /*
   * Vendor ticket 10. The review event carries `vendorId`, so the audience is a query for
   * that vendor's active members rather than a list of ids in the payload; the flag event
   * needs no lookup at all, because a permission audience is resolved from roles.
   */
  on("ProductReviewPublished", async (payload) => {
    await dispatch("ProductReviewPublished", payload, { vendorId: payload.vendorId });
  });

  on("ProductReviewFlagged", async (payload) => {
    await dispatch("ProductReviewFlagged", payload, {});
  });

  /*
   * Vendor ticket 09. Both go to every active member, owner or not: a member who cannot see
   * that a payout arrived cannot answer "did we get paid", and the thing worth restricting
   * is the payout *account*, not the news that money moved.
   */
  on("VendorPayoutPaid", async (payload) => {
    await dispatch("VendorPayoutPaid", payload, { vendorId: payload.vendorId });
  });

  on("VendorPayoutFailed", async (payload) => {
    await dispatch("VendorPayoutFailed", payload, { vendorId: payload.vendorId });
  });

  /*
   * Vendor ticket 05. `ProductSubmitted` goes to a *permission* audience and needs no
   * lookup at all; the other three resolve a `vendor_member` audience from the
   * `vendorId` on the payload — a query, never a list of user ids in the event.
   *
   * `ProductPublished` tolerates a missing `vendorId`: a first-party product has none,
   * `resolveAudience` returns nothing for the vendor audience, and `dispatch` writes
   * nothing. That is correct rather than defensive — there is no vendor to tell.
   */
  on("ProductSubmitted", async (payload) => {
    await dispatch("ProductSubmitted", payload, { productId: payload.productId });
  });

  on("ProductChangesRequested", async (payload) => {
    await dispatch("ProductChangesRequested", payload, {
      productId: payload.productId,
      vendorId: payload.vendorId,
    });
  });

  on("ProductApproved", async (payload) => {
    await dispatch("ProductApproved", payload, {
      productId: payload.productId,
      vendorId: payload.vendorId,
    });
  });

  /*
   * Not in `GENERIC`, because the audience needs the vendor looked up from the
   * payload — and, like `ProductPublished`, it must tolerate that vendor being
   * absent. A first-party plugin has no vendor, and the staff row in the
   * catalogue is what covers it.
   */
  on("AddonProvisioningRequested", async (payload) => {
    await dispatch("AddonProvisioningRequested", payload, {
      organizationId: payload.organizationId,
      ...(payload.vendorId ? { vendorId: payload.vendorId } : {}),
    });
  });

  on("ProductPublished", async (payload) => {
    await dispatch("ProductPublished", payload, {
      productId: payload.productId,
      ...(payload.vendorId ? { vendorId: payload.vendorId } : {}),
    });
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

  /*
   * Account security — the account holder, and **no actor**.
   *
   * `resolveAudience` strips `context.actorUserId` from every audience, because
   * nobody wants a notification about a button they just pressed. That rule is
   * right everywhere except here: the person who changed the password is exactly
   * the person who has to hear about it, and if it was not them then the actor is
   * an attacker. Passing an actor would filter the audience to nobody, and
   * `dispatch` would report a clean run having told no one.
   *
   * So `ownerUserId` is set and `actorUserId` is deliberately left unset. These
   * four are not in `GENERIC`, whose context is an organisation — a colleague has
   * no business knowing about somebody else's credentials.
   */
  on("PasswordChanged", async (payload) => {
    await dispatch("PasswordChanged", payload, { ownerUserId: payload.userId });
  });

  on("PasswordSet", async (payload) => {
    await dispatch("PasswordSet", payload, { ownerUserId: payload.userId });
  });

  on("SocialAccountLinked", async (payload) => {
    await dispatch("SocialAccountLinked", payload, { ownerUserId: payload.userId });
  });

  on("SocialAccountUnlinked", async (payload) => {
    await dispatch("SocialAccountUnlinked", payload, { ownerUserId: payload.userId });
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
