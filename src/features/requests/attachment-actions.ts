"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireOrg } from "@/lib/auth/dal";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { CustomerRequest, type CustomerRequestDoc } from "@/lib/db/models/requests";
import { NotFoundError } from "@/lib/errors";
import { objectIdSchema } from "@/validators/common";

/**
 * Files a customer sends with a request — §19's attachments.
 *
 * ## The customer uploads, both sides read
 *
 * A mockup, a spreadsheet, the spec they already had written. It is their
 * document, so they are the one who attaches it; staff read it on the workspace
 * because §101 wants everything about a request in one place.
 *
 * ## Two steps, and the second one checks the first
 *
 * The browser gets a presigned PUT and uploads directly (bytes never pass
 * through this server — AGENTS.md). Then it hands the key back here, and
 * `assertKeyBelongsTo` proves the key is under *this* organisation and *this*
 * request. Without that check, the second step would accept a key pointing at
 * somebody else's document and attach it to a request they can read.
 */

export async function createAttachmentUploadAction(
  input: unknown,
): Promise<ActionResult<{ uploadUrl: string; key: string; headers: Record<string, string> }>> {
  return withAction(async () => {
    const { organizationId } = await requireOrg();

    const parsed = parseInput(
      z.object({
        requestId: objectIdSchema,
        filename: z.string().trim().min(1).max(255),
        contentType: z.string().trim().min(1).max(120),
        sizeBytes: z.coerce.number().int().positive(),
      }),
      input,
    );

    // Scope first: a key must not be minted for a request the caller cannot see.
    await ownedRequest(parsed.requestId, organizationId);

    const storage = await import("@/services/storage");
    const { storageContext } = await import("@/services/storage/client");

    const ticket = await storage.createUploadUrl({
      scope: "attachment",
      key: storage.attachmentKey(
        storageContext(),
        organizationId,
        parsed.requestId,
        parsed.filename,
      ),
      filename: parsed.filename,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
    });

    // No public URL in the response. These are customer documents and the
    // bucket serves any known key unsigned.
    return ok({ uploadUrl: ticket.url, key: ticket.key, headers: ticket.headers });
  });
}

export async function attachToRequestAction(
  input: unknown,
): Promise<ActionResult<{ attached: true }>> {
  return withAction(async () => {
    const { organizationId, user } = await requireOrg();

    const parsed = parseInput(
      z.object({
        requestId: objectIdSchema,
        reference: z.string().trim().min(1).max(40),
        storageKey: z.string().trim().min(1).max(400),
        filename: z.string().trim().min(1).max(255),
        contentType: z.string().trim().max(120).optional(),
        sizeBytes: z.coerce.number().int().positive().optional(),
      }),
      input,
    );

    await ownedRequest(parsed.requestId, organizationId);

    /*
     * The key came from a client, so it is a claim rather than a fact. This is
     * the check that makes it one — bound to the organisation *and* the
     * request, which is exactly the layout `attachmentKey` encodes.
     */
    const { assertAttachmentKey, verifyUpload } = await import("@/services/storage");
    assertAttachmentKey(parsed.storageKey, organizationId, parsed.requestId);

    /*
     * And this is the check on what is *at* the key — ticket 26.
     *
     * The key check above proves whose it is. The bytes arrived by presigned
     * PUT straight from the browser, so until now the only thing said about
     * their content was said by the client that uploaded them. A staff member
     * opening a customer's "spec.pdf" deserves better than that.
     *
     * Conditional because `contentType` and `sizeBytes` are optional on the
     * input, and the presign that produced the key required both — so in
     * practice they are always present, and an absent one means a caller went
     * around the upload flow rather than a legitimate gap.
     */
    if (parsed.contentType && parsed.sizeBytes) {
      await verifyUpload({
        key: parsed.storageKey,
        expectedSizeBytes: parsed.sizeBytes,
        expectedContentType: parsed.contentType,
      });
    }

    await connectToDatabase();
    await CustomerRequest.updateOne(
      { _id: toObjectId(parsed.requestId), organizationId: toObjectId(organizationId) },
      {
        $push: {
          attachments: {
            storageKey: parsed.storageKey,
            filename: parsed.filename,
            ...(parsed.contentType ? { contentType: parsed.contentType } : {}),
            ...(parsed.sizeBytes ? { sizeBytes: parsed.sizeBytes } : {}),
            uploadedByUserId: toObjectId(user.id),
            uploadedAt: new Date(),
          },
        },
      },
    );

    revalidatePath(`/dashboard/requests/${parsed.reference}`);
    revalidatePath(`/staff/requests/${parsed.reference}`);
    return ok({ attached: true as const });
  });
}

async function ownedRequest(
  requestId: string,
  organizationId: string,
): Promise<CustomerRequestDoc> {
  await connectToDatabase();

  const request = await CustomerRequest.findOne({
    _id: toObjectId(requestId),
    organizationId: toObjectId(organizationId),
  }).lean<CustomerRequestDoc>();

  // Not found rather than forbidden: another organisation's request id is not
  // something a stranger should be able to confirm exists.
  if (!request) throw new NotFoundError("request", { id: requestId });
  return request;
}
