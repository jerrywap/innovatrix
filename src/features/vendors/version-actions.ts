"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { ForbiddenError } from "@/lib/errors";
import { objectIdSchema } from "@/validators/common";
import {
  confirmUploadSchema,
  uploadTicketRequestSchema,
  versionFormSchema,
} from "@/validators/product-version";
import { richTextFromForm, type RichTextDocument } from "@/lib/rich-text/schema";
import { vendorActor } from "@/services/audit";
import { catalogChanged } from "@/services/catalog/cache";
import * as fileService from "@/services/catalog/file-service";
import * as versionService from "@/services/catalog/version-service";

/**
 * A vendor's own releases and files — vendor ticket 06.
 *
 * ## The customer-facing download path does not change, and must not
 *
 * `/api/downloads/[fileId]` authorises, records the download, and 307s to a
 * five-minute presigned GET. Every delivery method resolves to a `ProductFile` in the
 * platform's own bucket *before* a customer asks for it, so a customer cannot tell
 * which of the three a vendor used — and §66's guarantee does not depend on somebody
 * else's uptime, retention or access control.
 *
 * This file is the **archive** method: a direct upload, which is the path ticket 07
 * already built. Nothing about it is new except that the uploader is now external,
 * which makes the magic-byte sniff in `verifyUpload()` matter more rather than less.
 *
 * ## Ownership derives through the product
 *
 * A version and a file carry no `vendorId` — vendor ticket 04's decision, because a
 * second axis would be a denormalised copy that can go stale. So every call passes a
 * scope and `ownership.ts` resolves it through `productId`, answering **404 rather
 * than 403** for somebody else's version.
 *
 * ## Why these are not the staff actions with a different guard
 *
 * They very nearly are, and the temptation was to add a `scope` parameter to
 * `features/versions/actions.ts` and let both surfaces call it. `action-guards.test.ts`
 * is the reason not to: it walks each action file for a guard reachable *in that
 * file*, so a shared action would have to accept a guard as an argument — and an
 * action whose authorisation arrives as a parameter is one call site away from being
 * handed the wrong one.
 */

const BASE = "/dashboard/selling/products";

function refresh(productId: string) {
  revalidatePath(`${BASE}/${productId}`, "layout");
  revalidatePath(BASE);
}

/**
 * Every action here starts the same way, and the check is not only the guard.
 *
 * A vendor whose account has been suspended keeps their existing entitlements serving
 * customers (vendor ticket 12) and must not be able to ship *new* bytes in the
 * meantime. The workspace is only reachable while `verified`, and this is the second
 * half of that — because a layout is not a permission check.
 */
async function activeVendor() {
  const context = await requireVendorOrForbid();
  if (context.vendor.status !== "verified") {
    throw new ForbiddenError("Your vendor account is not active.");
  }
  return context;
}

const versionTarget = z.object({ productId: objectIdSchema, versionId: objectIdSchema });
const fileTarget = z.object({ productId: objectIdSchema, fileId: objectIdSchema });

/* ────────────────────────────────────────────── versions */

export async function createVendorVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ versionId: string }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const raw = parseNestedFormData(formData);
    const input = parseInput(versionFormSchema, raw);

    const notes = readNotes(raw.releaseNotes);
    if (!notes.ok) {
      return fail(notes.message, {
        code: "VALIDATION",
        fieldErrors: { releaseNotes: [notes.message] },
      });
    }

    /*
     * The delivery method first, then the version.
     *
     * Both come from one form now (see `NewVersionForm`), and the order matters:
     * `releaseVersion` reads `deliveryMethod` to decide which artefact gate applies,
     * so a version created before its method was recorded would be judged against
     * the old one. Not a transaction — `saveSection` and `createVersion` are separate
     * writes — and it does not need to be: the worst interleaving leaves a product
     * whose method is set and whose version is not, which is the state the vendor
     * was in a moment earlier anyway.
     */
    const { method, ...versionInput } = input;
    if (method) {
      const { saveSection } = await import("@/services/catalog/product-service");
      await saveSection(
        versionInput.productId,
        "delivery",
        { deliveryMethod: method },
        vendorActor(context.user, context.vendorId),
        { vendorId: context.vendorId },
      );
    }

    const version = await versionService.createVersion(
      { ...versionInput, ...(notes.notes ? { releaseNotes: notes.notes } : {}) },
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    catalogChanged();
    refresh(input.productId);

    return ok({ versionId: String(version._id) });
  });
}

export async function updateVendorVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const raw = parseNestedFormData(formData);
    const { productId, versionId } = parseInput(versionTarget, raw);

    const notes = readNotes(raw.releaseNotes);
    if (!notes.ok) {
      return fail(notes.message, {
        code: "VALIDATION",
        fieldErrors: { releaseNotes: [notes.message] },
      });
    }

    await versionService.updateVersion(
      versionId,
      {
        ...(typeof raw.changelog === "string" ? { changelog: raw.changelog } : {}),
        ...(typeof raw.minimumRequirements === "string"
          ? { minimumRequirements: raw.minimumRequirements }
          : {}),
        ...(notes.notes ? { releaseNotes: notes.notes } : {}),
      },
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    catalogChanged();
    refresh(productId);

    return ok({ saved: true as const });
  });
}

/**
 * Release a version.
 *
 * `releaseVersion` refuses without an application package — a released version with
 * nothing to download looks available and is not — and stamps `releasedAt`, which
 * ticket 14 measures the update window from. It also emits
 * `ProductVersionReleased`, so every entitled customer is told **after** the artefact
 * is in place rather than before.
 *
 * One-way by design: a released version's artefacts cannot change at all, because "I
 * bought 2.4.0" has to keep meaning something. A correction ships as 2.4.1.
 */
export async function releaseVendorVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ released: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const { productId, versionId } = parseInput(versionTarget, parseNestedFormData(formData));

    await versionService.releaseVersion(
      versionId,
      vendorActor(context.user, context.vendorId),
      {
        vendorId: context.vendorId,
      },
    );

    catalogChanged();
    refresh(productId);

    return ok({ released: true as const });
  });
}

export async function deprecateVendorVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ deprecated: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const { productId, versionId } = parseInput(versionTarget, parseNestedFormData(formData));

    await versionService.deprecateVersion(
      versionId,
      vendorActor(context.user, context.vendorId),
      {
        vendorId: context.vendorId,
      },
    );

    catalogChanged();
    refresh(productId);

    return ok({ deprecated: true as const });
  });
}

export async function deleteVendorVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ deleted: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const { productId, versionId } = parseInput(versionTarget, parseNestedFormData(formData));

    await versionService.deleteVersion(versionId, vendorActor(context.user, context.vendorId), {
      vendorId: context.vendorId,
    });

    catalogChanged();
    refresh(productId);

    return ok({ deleted: true as const });
  });
}

/* ────────────────────────────────────────────── the other two delivery methods */

const artefactSourceSchema = z.object({
  productId: objectIdSchema,
  versionId: objectIdSchema,
  method: z.enum(["vendor_hosted", "repository"]),
  url: z.string().trim().max(2048).optional(),
  checksumSha256: z.string().trim().max(64).optional(),
  repositoryUrl: z.string().trim().max(2048).optional(),
  tag: z.string().trim().max(120).optional(),
  /**
   * Plaintext, once. Sealed by the service and never rendered back, so an empty field on
   * a re-save means "leave it alone" rather than "clear it" — a vendor editing the tag
   * must not silently drop the token they cannot see.
   */
  token: z.string().trim().max(512).optional(),
});

/**
 * Point a version at a remote artefact — vendor ticket 06.
 *
 * Recording the source is not fetching it. The fetch is a job, queued below, because a
 * 2GB artefact over somebody else's link does not belong in a request lifecycle. The URL
 * is validated *here* though, with the same `assertFetchable` the job uses, so a vendor
 * who mistypes a host is told while looking at the form.
 */
export async function saveArtefactSourceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ queued: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const input = parseInput(artefactSourceSchema, parseNestedFormData(formData));

    const { saveArtefactSource } = await import("@/services/catalog/artefact-service");
    await saveArtefactSource(
      {
        versionId: input.versionId,
        method: input.method,
        ...(input.url ? { url: input.url } : {}),
        ...(input.checksumSha256 ? { checksumSha256: input.checksumSha256 } : {}),
        ...(input.repositoryUrl ? { repositoryUrl: input.repositoryUrl } : {}),
        ...(input.tag ? { tag: input.tag } : {}),
        ...(input.token ? { token: input.token } : {}),
      },
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    // Queued with an idempotency key on the version, so a vendor who saves twice while
    // the first fetch is still running gets one job rather than two racing writes to the
    // same storage key.
    const { enqueue } = await import("@/services/jobs/queue");
    await enqueue(
      "mirror-vendor-artefact",
      { versionId: input.versionId },
      { idempotencyKey: `mirror:${input.versionId}` },
    );

    refresh(input.productId);
    return ok({ queued: true as const });
  });
}

/**
 * Try the fetch again after a failure.
 *
 * A separate action from saving the source, because the common case after a failure is
 * "the vendor's server was down and nothing needs changing" — and making them re-enter a
 * checksum to retry would be a form that punishes them for our transient error.
 *
 * A fresh idempotency key, or the completed job's row would swallow the retry.
 */
export async function retryArtefactFetchAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ queued: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const { productId, versionId } = parseInput(versionTarget, parseNestedFormData(formData));

    const { requireOwnedVersion } = await import("@/services/catalog/ownership");
    const { version } = await requireOwnedVersion(versionId, { vendorId: context.vendorId });

    const { enqueue } = await import("@/services/jobs/queue");
    await enqueue(
      "mirror-vendor-artefact",
      { versionId },
      {
        idempotencyKey: `mirror:${versionId}:${version.artefactSource?.lastAttemptAt?.getTime() ?? 0}`,
      },
    );

    refresh(productId);
    return ok({ queued: true as const });
  });
}

/* ────────────────────────────────────────────── files */

/**
 * Step one of the upload: a presigned `PUT`.
 *
 * The key is built **server-side** from ids the server already trusts, and the
 * signature is bound to the exact content type and byte length, so the ticket cannot
 * be replayed to upload something else. Ownership is checked here as well as at
 * step two: a ticket is a signed permission to write into our bucket, and issuing one
 * to somebody who does not own the product is the wrong place to be generous.
 */
export async function requestVendorUploadAction(
  input: unknown,
): Promise<
  ActionResult<{ url: string; key: string; headers: Record<string, string>; expiresAt: string }>
> {
  return withAction(async () => {
    const context = await activeVendor();

    const parsed = parseInput(uploadTicketRequestSchema, input);
    const ticket = await fileService.requestUpload(parsed, { vendorId: context.vendorId });

    return ok({
      url: ticket.url,
      key: ticket.key,
      headers: ticket.headers,
      expiresAt: ticket.expiresAt.toISOString(),
    });
  });
}

/**
 * Step two — the bytes are up.
 *
 * `assertProductFileKey` runs before anything else touches the key: being inside the
 * environment prefix only proves it is one of ours, not that it is *this* product's,
 * and the second half of a two-step upload is exactly where that gets attacked.
 * Then `verifyUpload()` HEADs the object, checks the size and declared type, range
 * reads 4KB and sniffs magic numbers — so a `.exe` renamed `.zip` is refused whichever
 * method delivered it.
 */
export async function confirmVendorUploadAction(
  input: unknown,
): Promise<ActionResult<{ fileId: string }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const parsed = parseInput(confirmUploadSchema, input);
    const file = await fileService.confirmUpload(
      {
        ...parsed,
        ...(parsed.checksumSha256 ? { checksumSha256: parsed.checksumSha256 } : {}),
      },
      vendorActor(context.user, context.vendorId),
      { vendorId: context.vendorId },
    );

    catalogChanged();
    refresh(parsed.productId);

    return ok({ fileId: String(file._id) });
  });
}

export async function removeVendorFileAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ removed: true }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const { productId, fileId } = parseInput(fileTarget, parseNestedFormData(formData));

    await fileService.removeFile(fileId, vendorActor(context.user, context.vendorId), {
      vendorId: context.vendorId,
    });

    catalogChanged();
    refresh(productId);

    return ok({ removed: true as const });
  });
}

/**
 * A short-lived URL so a vendor can check what they uploaded.
 *
 * Two minutes. The scope check is the point: without it this would hand any vendor a
 * signed URL for any file in the catalogue, which is the paid-artefact leak §66 exists
 * to prevent — and it would not look like a leak, because the route is authenticated.
 */
export async function vendorDownloadUrlAction(
  fileId: string,
): Promise<ActionResult<{ url: string }>> {
  return withAction(async () => {
    const context = await activeVendor();

    const parsed = objectIdSchema.safeParse(fileId);
    if (!parsed.success) return fail("That is not a file.", { code: "VALIDATION" });

    const { requireOwnedFile } = await import("@/services/catalog/ownership");
    await requireOwnedFile(parsed.data, { vendorId: context.vendorId });

    const { url } = await fileService.downloadUrlFor(parsed.data, { expiresInSeconds: 120 });
    return ok({ url });
  });
}

/**
 * The release notes, from the editor's hidden JSON field.
 *
 * One line, because `richTextFromForm` is the decoder — this only decides what a
 * failure means here. Two private copies of a `JSON.parse` wrapper used to live in
 * this file and its twin, and both **dropped** unreadable input to `undefined`
 * while one of them carried a comment claiming it refused. `undefined` is how you
 * say "no notes", so dropping meant a corrupted payload silently erased notes that
 * were fine.
 */
function readNotes(
  value: unknown,
): { ok: true; notes: RichTextDocument | undefined } | { ok: false; message: string } {
  const parsed = richTextFromForm.safeParse(value);
  if (parsed.success) return { ok: true, notes: parsed.data };
  return {
    ok: false,
    message: parsed.error.issues[0]?.message ?? "Those release notes could not be read.",
  };
}
