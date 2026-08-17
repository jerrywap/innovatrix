"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { formDataToObject } from "@/lib/action-result";
import {
  requirePermission,
  requireVendorOrForbid,
  requireVendorOwner,
  requireVerifiedUser,
  getSession,
} from "@/lib/auth/dal";
import { serverEnv } from "@/config/env";
import { ForbiddenError } from "@/lib/errors";
import { LIMITS, consume } from "@/lib/rate-limit";
import { staffActor, vendorActor } from "@/services/audit";
import { sendAuthEmail, vendorInvitationMessage } from "@/services/email";
import * as documentService from "@/services/vendors/document-service";
import * as memberService from "@/services/vendors/member-service";
import * as vendorService from "@/services/vendors/vendor-service";
import {
  documentConfirmSchema,
  documentUploadRequestSchema,
  inviteMemberSchema,
  invitationIdSchema,
  memberIdSchema,
  payoutAccountSchema,
  reviewApplicationSchema,
  vendorApplicationSchema,
  vendorProfileSchema,
  verificationDecisionSchema,
} from "./schemas";

/**
 * Vendor actions — vendor tickets 01–03.
 *
 * Deliberately thin, like `products/actions.ts`: guard, parse, call a service,
 * invalidate, return. No `if` about domain state lives here.
 *
 * Every one re-checks its guard. A server action is a public POST endpoint, and a
 * nav item that isn't drawn is not a permission check — `action-guards.test.ts`
 * walks this file and will fail on an export that reaches none.
 */

function refreshSelling() {
  revalidatePath("/dashboard/selling", "layout");
}

function refreshStaffVendors(vendorId?: string) {
  revalidatePath("/staff/vendor-applications");
  if (vendorId) revalidatePath(`/staff/vendor-applications/${vendorId}`);
}

/* ────────────────────────────────────────────── applying */

/**
 * Apply to become a vendor.
 *
 * `requireVerifiedUser` rather than `requireUser`: the application records an
 * agreement acceptance against this person, and an acceptance from an address
 * nobody has confirmed is not worth having. It is also the identity the owner
 * membership hangs off.
 */
export async function applyAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ applied: true }>> {
  let applied = false;

  const result = await withAction<{ applied: true }>(async () => {
    const user = await requireVerifiedUser();
    const input = parseInput(vendorApplicationSchema, formDataToObject(formData));

    await vendorService.apply(
      {
        displayName: input.displayName,
        contactEmail: input.contactEmail,
        country: input.country,
        pitch: input.pitch,
        ...(input.supportEmail ? { supportEmail: input.supportEmail } : {}),
        ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
      },
      { id: user.id, ...(user.name ? { name: user.name } : {}) },
    );

    refreshSelling();
    revalidatePath("/dashboard", "layout");
    refreshStaffVendors();
    applied = true;

    return ok({ applied: true as const });
  });

  if (result.ok && applied) redirect("/dashboard/selling");
  return result;
}

/* ────────────────────────────────────────────── profile */

export async function saveProfileAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(vendorProfileSchema, formDataToObject(formData));

    await vendorService.saveProfile(
      context.vendorId,
      input,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ saved: true as const });
  });
}

/**
 * Save the payout account — vendor ticket 09.
 *
 * `requireVendorOwner`, and that guard is the reason the two-role model exists at all: a
 * wrong price is reversible and audited, and a wrong account number is money in a stranger's
 * hands. A `member` is refused here in the action, not merely undrawn in the UI — and the
 * *read* is owner-only too, because a member who can see the details can copy them out.
 *
 * The service holds payouts and returns the vendor to business re-verification. That belongs
 * there rather than here: it is a domain consequence of changing a payee, and an action-layer
 * version of it would be missed by the next caller.
 */
export async function savePayoutAccountAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(payoutAccountSchema, formDataToObject(formData));

    await vendorService.savePayoutAccount(
      context.vendorId,
      input,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ saved: true as const });
  });
}

/**
 * Accept the current agreement version — vendor ticket 07.
 *
 * Owner-only: it is the owner who is bound by the terms, and a `member` invited to help with
 * products has no business agreeing to them on somebody else's behalf.
 *
 * No form fields at all beyond the submit — the version in force is a server fact, and
 * taking it from the request would let a caller accept a version that no longer exists.
 */
export async function acceptAgreementAction(
  // Both parameters are unused and both must stay: `useActionState` calls an action with
  // `(previousState, formData)`, and there is deliberately no field to read — see above.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _previous: ActionResult<unknown> | null,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _formData: FormData,
): Promise<ActionResult<{ accepted: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();

    await vendorService.acceptAgreement(
      context.vendorId,
      context.user.id,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ accepted: true as const });
  });
}

/* ────────────────────────────────────────────── team */

/**
 * Invite somebody to the vendor.
 *
 * Owner-only, and rate-limited: it sends an email to an address the caller chose,
 * which is the same property that earns password reset a limit.
 */
export async function inviteMemberAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ invited: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(inviteMemberSchema, formDataToObject(formData));

    const limit = await consume(LIMITS.vendorInvite, context.vendorId);
    if (!limit.allowed) {
      return fail("Too many invitations just now. Try again in a little while.", {
        code: "RATE_LIMITED",
      });
    }

    const invitation = await memberService.invite(context.vendorId, input, {
      ...vendorActor(context.user, context.vendorId),
      userId: context.user.id,
    });

    // Outside the service: sending mail is a side effect that must not sit inside
    // anything retryable, and a failed send must not lose the invitation — the
    // owner can resend from the same screen.
    await sendAuthEmail(
      vendorInvitationMessage({
        to: invitation.email,
        vendorName: context.vendor.displayName,
        inviterName: context.user.name || context.user.email,
        role: invitation.role,
        url: `${serverEnv().APP_URL}/accept-invite?vendorInvite=${String(invitation._id)}`,
      }),
    );

    refreshSelling();
    return ok({ invited: true as const });
  });
}

export async function revokeInvitationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ revoked: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const { invitationId } = parseInput(invitationIdSchema, formDataToObject(formData));

    await memberService.revokeInvitation(
      context.vendorId,
      invitationId,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ revoked: true as const });
  });
}

export async function revokeMemberAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ revoked: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const { memberId } = parseInput(memberIdSchema, formDataToObject(formData));

    await memberService.revokeMember(
      context.vendorId,
      memberId,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ revoked: true as const });
  });
}

export async function transferOwnershipAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ transferred: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const { memberId } = parseInput(memberIdSchema, formDataToObject(formData));

    await memberService.transferOwnership(
      context.vendorId,
      memberId,
      context.user.id,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ transferred: true as const });
  });
}

/**
 * Accept a vendor invitation.
 *
 * A POST, never a GET, for the reason the org accept page already documents: a
 * bare link that joins an account would fire from any email client's link
 * prefetcher.
 *
 * `getSession()` rather than a `require*` guard, because this is the one vendor
 * action whose caller is *not* yet a vendor. The identity checks that matter —
 * the email matches the invitation and is verified — are in the service, where a
 * second caller cannot skip them.
 */
export async function acceptVendorInviteAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ joined: true }>> {
  let joined = false;

  const result = await withAction<{ joined: true }>(async () => {
    const session = await getSession();
    if (!session) throw new ForbiddenError("Sign in to accept this invitation.");

    const { invitationId } = parseInput(invitationIdSchema, formDataToObject(formData));

    await memberService.acceptInvitation(invitationId, {
      id: session.user.id,
      email: session.user.email,
      emailVerified: session.user.emailVerified,
      ...(session.user.name ? { name: session.user.name } : {}),
    });

    revalidatePath("/dashboard", "layout");
    refreshSelling();
    joined = true;

    return ok({ joined: true as const });
  });

  if (result.ok && joined) redirect("/dashboard/selling");
  return result;
}

/* ────────────────────────────────────────────── verification documents */

/**
 * A presigned `PUT` for a verification document.
 *
 * Takes `input: unknown` rather than `FormData`, like every other upload action:
 * the bytes never enter an action body, so there is no form to parse.
 */
export async function requestDocumentUploadAction(
  input: unknown,
): Promise<
  ActionResult<{ url: string; key: string; headers: Record<string, string>; expiresAt: string }>
> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const parsed = parseInput(documentUploadRequestSchema, input);

    const ticket = await documentService.requestUpload({
      vendorId: context.vendorId,
      ...parsed,
    });

    return ok({
      url: ticket.url,
      key: ticket.key,
      headers: ticket.headers,
      expiresAt: ticket.expiresAt.toISOString(),
    });
  });
}

export async function confirmDocumentUploadAction(
  input: unknown,
): Promise<ActionResult<{ documentId: string }>> {
  return withAction(async () => {
    const context = await requireVendorOrForbid();
    const parsed = parseInput(documentConfirmSchema, input);

    const document = await documentService.confirmUpload(
      { vendorId: context.vendorId, ...parsed },
      { ...vendorActor(context.user, context.vendorId), userId: context.user.id },
    );

    refreshSelling();
    refreshStaffVendors(context.vendorId);

    return ok({ documentId: String(document._id) });
  });
}

/* ────────────────────────────────────────────── staff review */

/**
 * Decide an application.
 *
 * Gated on `vendor.review` — who sells here is a commercial judgement, and it is
 * a different permission from approving the evidence behind an identity.
 */
export async function reviewApplicationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ decided: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.review");
    const input = parseInput(reviewApplicationSchema, formDataToObject(formData));

    const to =
      input.decision === "start_review"
        ? "in_review"
        : input.decision === "verify"
          ? "verified"
          : "rejected";

    const requestHeaders = await headers();
    const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
    const userAgent = requestHeaders.get("user-agent");

    await vendorService.transition(input.vendorId, to, staffActor(staff.user), {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(ip ? { ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    });

    refreshStaffVendors(input.vendorId);
    revalidatePath("/staff");

    return ok({ decided: true as const });
  });
}

/**
 * Approve or reject one verification level, then purge what was read.
 *
 * The purge runs after the decision and its failure is tolerated — see
 * `purgeDecidedDocuments`. Refusing the decision because a bucket policy denies
 * `DeleteObject` would be the wrong failure to choose.
 */
export async function decideVerificationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ decided: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.verify");
    const input = parseInput(verificationDecisionSchema, formDataToObject(formData));

    const documents = await documentService.listDocuments(input.vendorId);
    const hashes = documents
      .filter((document) => document.level === input.level)
      .map((document) => document.sha256)
      .filter((hash): hash is string => Boolean(hash));

    await vendorService.decideVerification(
      input.vendorId,
      {
        level: input.level,
        outcome: input.outcome,
        documentHashes: hashes,
        ...(input.note ? { note: input.note } : {}),
      },
      { ...staffActor(staff.user), userId: staff.user.id },
    );

    await documentService.purgeDecidedDocuments(
      input.vendorId,
      input.level,
      staffActor(staff.user),
    );

    refreshStaffVendors(input.vendorId);
    refreshSelling();

    return ok({ decided: true as const });
  });
}
