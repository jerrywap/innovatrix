"use server";

import { revalidatePath } from "next/cache";
import { formDataToObject, ok, parseInput, withAction } from "@/lib/action-result";
import type { ActionResult } from "@/lib/action-result";
import { requirePermission } from "@/lib/auth/dal";
import { ValidationError } from "@/lib/errors";
import { staffActor } from "@/services/audit";
import * as payouts from "@/services/payouts/payout-service";
import {
  evidenceUploadRequestSchema,
  payoutCancelSchema,
  payoutConfirmSchema,
  payoutFailSchema,
  payoutIdSchema,
} from "./schemas";

/**
 * Payout actions — vendor ticket 09.
 *
 * The permissions are the control, and they are split three ways on purpose: preparing a batch
 * is a job, **approving** is `payout.approve`, and sending is `payout.send`. An organisation
 * that wants two pairs of eyes on money leaving can grant those to different people; one that
 * does not, grants both to finance. Either way, no code path approves a payout.
 *
 * Thin, like every action module here: guard, parse, service, invalidate. Every export
 * re-checks its own permission — `action-guards.test.ts` walks this file.
 */

function refresh(payoutId?: string) {
  revalidatePath("/admin/payouts");
  if (payoutId) revalidatePath(`/admin/payouts/${payoutId}`);
  // The vendor's own screens show the payout and the balance behind it.
  revalidatePath("/dashboard/selling/payouts", "layout");
  revalidatePath("/dashboard/selling/earnings");
}

/**
 * `draft → approved`. The human decision the whole design rests on.
 *
 * Approving does not send anything. Two steps rather than one because they answer different
 * questions — "is this the right amount to the right vendor" and "has the transfer been made"
 * — and collapsing them would mean the person checking the figures is also the person
 * confirming a bank transfer they may not have made yet.
 */
export async function approvePayoutAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ approved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payout.approve");
    const input = parseInput(payoutIdSchema, formDataToObject(formData));

    await payouts.approve(input.payoutId, staffActor(staff.user));

    refresh(input.payoutId);
    return ok({ approved: true as const });
  });
}

/**
 * `approved → sending`, and the driver is asked.
 *
 * With the `manual` driver this records the intent to transfer and nothing else — the money
 * moves in somebody's banking app, and `confirmPayoutAction` records that it did.
 */
export async function sendPayoutAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ sending: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payout.send");
    const input = parseInput(payoutIdSchema, formDataToObject(formData));

    await payouts.send(input.payoutId, staffActor(staff.user));

    refresh(input.payoutId);
    return ok({ sending: true as const });
  });
}

/**
 * A presigned `PUT` for the remittance advice.
 *
 * `input: unknown` rather than `FormData`, like every other upload action: the bytes never
 * enter an action body (AGENTS.md), so there is no form to parse.
 */
export async function requestEvidenceUploadAction(
  input: unknown,
): Promise<
  ActionResult<{ url: string; key: string; headers: Record<string, string>; expiresAt: string }>
> {
  return withAction(async () => {
    await requirePermission("payout.send");
    const parsed = parseInput(evidenceUploadRequestSchema, input);

    const { createUploadUrl, payoutEvidencePath } = await import("@/services/storage");

    // The key is built **server-side** from the payout id, so a client cannot choose where
    // bytes land. `assertPayoutEvidenceKey` checks the returned key on the way back in.
    const ticket = await createUploadUrl({
      scope: "payout-evidence",
      key: payoutEvidencePath(parsed.payoutId, parsed.filename),
      filename: parsed.filename,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
    });

    return ok({
      url: ticket.url,
      key: ticket.key,
      headers: ticket.headers,
      expiresAt: ticket.expiresAt.toISOString(),
    });
  });
}

/**
 * `sending → paid`, with the bank reference and the remittance advice.
 *
 * The evidence is verified **before** the payout is closed: `assertPayoutEvidenceKey` proves
 * the key belongs to this payout, and `verifyUpload` sniffs the bytes, because the key proves
 * nothing about what is at it and a browser put it there.
 */
export async function confirmPayoutAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ paid: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payout.send");
    const input = parseInput(payoutConfirmSchema, formDataToObject(formData));

    let evidence: { storageKey: string; filename: string; contentType?: string } | undefined;

    if (input.storageKey) {
      if (!input.filename || !input.contentType || !input.sizeBytes) {
        throw new ValidationError("The upload did not finish. Try attaching the file again.", {
          storageKey: ["Missing the filename, type or size that came with it."],
        });
      }

      const { assertPayoutEvidenceKey, verifyUpload } = await import("@/services/storage");
      const key = assertPayoutEvidenceKey(input.storageKey, input.payoutId);

      await verifyUpload({
        key,
        expectedSizeBytes: input.sizeBytes,
        expectedContentType: input.contentType,
      });

      evidence = {
        storageKey: key,
        filename: input.filename,
        ...(input.contentType ? { contentType: input.contentType } : {}),
      };
    }

    await payouts.markPaid(
      input.payoutId,
      {
        ...(input.externalReference ? { externalReference: input.externalReference } : {}),
        ...(evidence ? { evidence } : {}),
      },
      staffActor(staff.user),
    );

    refresh(input.payoutId);
    return ok({ paid: true as const });
  });
}

/**
 * The transfer was refused.
 *
 * Returns the payout to `approved` with the reason on it, still holding its claim, so the next
 * attempt pays exactly the same entries. Nothing is stranded — the entries never left
 * `cleared`.
 */
export async function failPayoutAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ failed: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payout.send");
    const input = parseInput(payoutFailSchema, formDataToObject(formData));

    await payouts.markFailed(input.payoutId, input.reason, staffActor(staff.user));

    refresh(input.payoutId);
    return ok({ failed: true as const });
  });
}

/**
 * Cancel it, releasing the claim.
 *
 * `payout.approve` rather than `payout.send`: cancelling is a decision about whether money is
 * owed at all, which is the approver's question. The entries go back to the pool and the next
 * batch redrafts them.
 */
export async function cancelPayoutAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ cancelled: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("payout.approve");
    const input = parseInput(payoutCancelSchema, formDataToObject(formData));

    await payouts.cancel(input.payoutId, input.reason, staffActor(staff.user));

    refresh(input.payoutId);
    return ok({ cancelled: true as const });
  });
}
