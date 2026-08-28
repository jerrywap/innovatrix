"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { formDataToObject } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
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
import { catalogChanged, vendorChanged } from "@/services/catalog/cache";
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
  accountTypeSchema,
  documentRemoveSchema,
  verificationSubmitSchema,
  verificationWaiverSchema,
  payoutAccountSchema,
  reviewApplicationSchema,
  vendorApplicationSchema,
  vendorProfileSchema,
  verificationDecisionSchema,
  brandingUploadSchema,
  storefrontDefaultsSchema,
  storefrontVisibilitySchema,
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

/**
 * The public storefront's cache — vendor ticket 11.
 *
 * `getStorefront` is a `"use cache"` read, so a profile edit or a verification decision would
 * otherwise take up to the cache window to show. Called with the **slug**, which is immutable
 * once verified (vendor ticket 01) — that immutability is what makes a slug-keyed tag safe.
 */
function refreshStorefront(slug?: string) {
  if (slug) vendorChanged(slug);
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
    refreshStorefront(context.vendor.slug);
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

    const vendor = await vendorService.transition(input.vendorId, to, staffActor(staff.user), {
      ...(input.reason ? { reason: input.reason } : {}),
      ...(ip ? { ip } : {}),
      ...(userAgent ? { userAgent } : {}),
    });

    refreshStaffVendors(input.vendorId);
    // Verifying a vendor creates their storefront and suspending one removes it, so the
    // cached read has to go either way — vendor ticket 11.
    refreshStorefront(vendor.slug);
    revalidatePath("/staff");

    return ok({ decided: true as const });
  });
}

/**
 * Choose sole trader or company — the first question of verification.
 *
 * Owner-only: it decides what documents the vendor is asked for and it is the
 * claim the payout account is checked against, which is the one capability the
 * two-role split exists to keep away from a `member`.
 */
export async function setAccountTypeAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(accountTypeSchema, formDataToObject(formData));

    await vendorService.setAccountType(context.vendorId, input.accountType, {
      type: "customer",
      userId: context.user.id,
      ...(context.user.name ? { name: context.user.name } : {}),
    });

    refreshSelling();
    return ok({ saved: true as const });
  });
}

/**
 * Mark a requirement not applicable, or take that back.
 *
 * Owner-only, like every other statement about what this vendor is: a waiver is a
 * declaration a reviewer will rely on.
 */
export async function setVerificationWaiverAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(verificationWaiverSchema, formDataToObject(formData));

    await vendorService.setVerificationWaiver(
      context.vendorId,
      `${input.level}.${input.kind}`,
      input.waived,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ saved: true as const });
  });
}

/**
 * Take back a document that has not been read yet.
 *
 * Owner-only and scoped to the caller's own vendor inside the service — the
 * `documentId` arrives from the client, so it is a claim about which document,
 * never about whose.
 */
export async function removeDocumentAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ removed: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(documentRemoveSchema, formDataToObject(formData));

    await documentService.removeDocument(
      input.documentId,
      context.vendorId,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ removed: true as const });
  });
}

/** Hand one level to a reviewer. See `submitVerificationLevel`. */
export async function submitVerificationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ submitted: true }>> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const input = parseInput(verificationSubmitSchema, formDataToObject(formData));

    await vendorService.submitVerificationLevel(
      context.vendorId,
      input.level,
      vendorActor(context.user, context.vendorId),
    );

    refreshSelling();
    return ok({ submitted: true as const });
  });
}

/**
 * Approve or reject one verification level.
 *
 * ## The documents are kept
 *
 * This used to call `purgeDecidedDocuments` immediately after the decision, and
 * the verification screen promised as much. That was the wrong default for a
 * marketplace that pays people: anti-money-laundering and know-your-customer
 * regimes require the identity evidence behind a payout to be **retained**,
 * typically for five years after the relationship ends, and a platform that
 * destroyed it the moment a reviewer clicked "approve" could not answer the one
 * question those rules exist to ask.
 *
 * GDPR and the NDPR do not conflict with that — both carry an exemption for
 * processing necessary to comply with a legal obligation, and both are satisfied
 * by *bounded* retention rather than by deletion on sight. So the erasure path
 * still exists and is still audited (`purgeDecidedDocuments`); what changed is
 * that it is now a deliberate act — an erasure request, or the end of a
 * retention period — instead of a side effect of a decision.
 *
 * The hashes are still recorded with the decision. They cost nothing and they
 * are what makes a stored document provably the one that was read.
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

    refreshStaffVendors(input.vendorId);
    refreshSelling();

    return ok({ decided: true as const });
  });
}

/* ────────────────────────────────────────────── storefront artwork */

/**
 * A presigned PUT for a vendor's cover image or logo.
 *
 * ## Nothing about the destination comes from the client
 *
 * The key is `vendors/{vendorId}/branding/{kind}`, built here from
 * `context.vendorId` — the session's, never a form field. So unlike
 * `createVendorMediaUploadAction`, which has to check a client-supplied
 * `replaceKey` against the product it claims to belong to, there is no claim to
 * check: `kind` is a two-value enum and the vendor is whoever is signed in.
 *
 * That is also why the key is *stable* rather than minted. A second cover
 * overwrites the first, so a vendor trying four of them leaves one object rather
 * than four — which matters while `s3:DeleteObject` is denied and nothing ever
 * cleans up. `publicObjectUrl`'s `?v=` stamp is what stops every cache in the
 * path from serving the previous bytes from an unchanged URL.
 *
 * ## `requireVendorOwner`, not `requireVendorOrForbid`
 *
 * The profile form this feeds is owner-only — `saveProfileAction` and the
 * settings page both are — so a member who could mint a ticket here could write
 * bytes they would then be unable to save a reference to. Matching the guard to
 * the form keeps "who may change how we look" one answer instead of two.
 */
export async function createBrandingUploadAction(input: unknown): Promise<
  ActionResult<{
    uploadUrl: string;
    key: string;
    headers: Record<string, string>;
    publicUrl: string;
  }>
> {
  return withAction(async () => {
    const context = await requireVendorOwner();
    const parsed = parseInput(brandingUploadSchema, input);

    const storage = await import("@/services/storage");
    const key = storage.vendorBrandingPath(context.vendorId, parsed.kind);

    const ticket = await storage.createUploadUrl({
      scope: "vendor-branding",
      key,
      filename: parsed.filename,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
    });

    return ok({
      uploadUrl: ticket.url,
      key: ticket.key,
      publicUrl: storage.publicObjectUrl(ticket.key, { version: Date.now() }),
      headers: ticket.headers,
    });
  });
}

/* ────────────────────────────────────────────── storefront visibility (staff) */

/**
 * Decide what one vendor's storefront shows — vendor ticket 11, revisited.
 *
 * ## Why `vendor.review` rather than a new permission
 *
 * The three vendor permissions are split by blast radius, and this one lands
 * squarely in the same place as `vendor.suspend` and `review.moderate`: it is a
 * commercial and editorial call about a live storefront, which is
 * `marketplace_manager`'s job. `finance` holds `vendor.verify` and *not*
 * `vendor.review`, so gating here keeps finance out — which is the correct
 * answer and one a fresh permission would have had to reproduce by hand in every
 * role, or fail `assertMatrixIsComplete()`.
 *
 * ## Both caches, because there are two readers
 *
 * `vendorChanged` clears the public storefront's `"use cache"` entry. The
 * vendor's own preview reads uncached, but sits inside the dashboard's router
 * cache, so it needs its path revalidated or the vendor is told nothing until
 * they hard-reload.
 */
export async function setStorefrontVisibilityAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("vendor.review");
    // `parseNestedFormData`, because the radios are named `fields.website` and
    // `formDataToObject` would hand Zod a flat key with a dot in it rather than a
    // record. Same reason `toggleProviderAction` reaches for it.
    const input = parseInput(storefrontVisibilitySchema, parseNestedFormData(formData));

    const vendor = await vendorService.setStorefrontVisibility(
      input.vendorId,
      input.fields,
      staffActor(staff.user),
    );

    refreshStaffVendors(input.vendorId);
    refreshStorefront(vendor.slug);
    revalidatePath("/dashboard/selling/storefront");

    return ok({ saved: true as const });
  });
}

/**
 * The platform-wide defaults.
 *
 * `settings.manage`, because this is platform configuration rather than a
 * judgement about one vendor — the same permission `/admin/settings` already
 * required when it was a placeholder.
 *
 * **`catalogChanged()`, not `vendorChanged()`.** This changes every storefront at
 * once, and `getVendorProfile` is tagged with `CATALOG_TAG` as well as its own
 * `vendor:{slug}` — which is exactly what makes one call enough instead of a
 * scan of every vendor.
 */
export async function saveStorefrontDefaultsAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("settings.manage");
    const input = parseInput(storefrontDefaultsSchema, parseNestedFormData(formData));

    await vendorService.saveStorefrontDefaults(
      input.fields,
      staffActor(staff.user),
      staff.user.id,
    );

    catalogChanged();
    revalidatePath("/admin/settings");
    revalidatePath("/dashboard/selling/storefront");

    return ok({ saved: true as const });
  });
}
