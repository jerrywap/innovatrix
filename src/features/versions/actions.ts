"use server";

import { revalidatePath } from "next/cache";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission } from "@/lib/auth/dal";
import { richTextFromForm, type RichTextDocument } from "@/lib/rich-text/schema";
import { objectIdSchema } from "@/validators/common";
import {
  confirmUploadSchema,
  releasedVersionEditSchema,
  uploadTicketRequestSchema,
  versionFormSchema,
} from "@/validators/product-version";
import { staffActor } from "@/services/audit";
import { catalogChanged } from "@/services/catalog/cache";
import * as fileService from "@/services/catalog/file-service";
import * as versionService from "@/services/catalog/version-service";
import { z } from "zod";

/**
 * Version and file actions — ticket 07.
 *
 * Same shape as the product actions: permission, parse, service, invalidate,
 * return. The permission is `product.manage_files` throughout, which §77 gives
 * to `content_manager` — releasing a version is not publishing a product, and
 * the person who prepares a build is usually not the person who lists it.
 */

const idPair = z.object({ productId: objectIdSchema, versionId: objectIdSchema });
const fileTarget = z.object({ productId: objectIdSchema, fileId: objectIdSchema });

function refresh(productId: string) {
  revalidatePath(`/admin/products/${productId}`, "layout");
  revalidatePath("/admin/products");
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

/* ────────────────────────────────────────────── versions */

export async function createVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ versionId: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

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
     * `method` is dropped rather than passed on. The staff form offers no delivery
     * choice — first-party products are always `archive` — and a field the surface
     * does not show is one the body should not be trusted for. Deleted from the
     * object rather than destructured out, because an unused binding is a lint
     * warning and this is a deliberate discard, not a leftover.
     */
    const versionInput = { ...input };
    delete versionInput.method;

    const version = await versionService.createVersion(
      { ...versionInput, ...(notes.notes ? { releaseNotes: notes.notes } : {}) },
      staffActor(staff.user),
    );

    catalogChanged();
    refresh(input.productId);

    return ok({ versionId: String(version._id) });
  });
}

export async function updateVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

    const raw = parseNestedFormData(formData);
    const { productId, versionId } = parseInput(idPair, raw);

    // Which schema applies is decided by the *stored* status, never by a
    // hidden field — a client that says "this one is still a draft" would
    // otherwise unlock the frozen fields.
    const stored = await versionService.findVersion(versionId);
    const isDraft = stored?.status === "draft";

    const input = isDraft
      ? parseInput(versionFormSchema.omit({ version: true }), raw)
      : parseInput(releasedVersionEditSchema, raw);

    const notes = readNotes(raw.releaseNotes);
    if (!notes.ok) {
      return fail(notes.message, {
        code: "VALIDATION",
        fieldErrors: { releaseNotes: [notes.message] },
      });
    }

    await versionService.updateVersion(
      versionId,
      { ...input, ...(notes.notes !== undefined ? { releaseNotes: notes.notes } : {}) },
      staffActor(staff.user),
    );

    catalogChanged();
    refresh(productId);

    return ok({ saved: true as const });
  });
}

export async function releaseVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ released: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

    const { productId, versionId } = parseInput(idPair, parseNestedFormData(formData));
    await versionService.releaseVersion(versionId, staffActor(staff.user));

    catalogChanged();
    refresh(productId);

    return ok({ released: true as const });
  });
}

export async function deprecateVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ deprecated: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

    const { productId, versionId } = parseInput(idPair, parseNestedFormData(formData));
    await versionService.deprecateVersion(versionId, staffActor(staff.user));

    catalogChanged();
    refresh(productId);

    return ok({ deprecated: true as const });
  });
}

export async function deleteVersionAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ deleted: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

    const { productId, versionId } = parseInput(idPair, parseNestedFormData(formData));
    await versionService.deleteVersion(versionId, staffActor(staff.user));

    catalogChanged();
    refresh(productId);

    return ok({ deleted: true as const });
  });
}

/* ────────────────────────────────────────────── files */

/**
 * Mint a presigned PUT.
 *
 * Called from the browser before the upload starts, and returns a URL that is
 * valid for an hour — long enough for the 500MB package in this ticket's
 * acceptance criteria at a realistic upstream speed.
 *
 * Note what is **not** returned: no credentials, no bucket name beyond what is
 * already in the URL, and no key the caller did not effectively choose. The URL
 * is single-purpose — one PUT, one key, one exact byte count.
 */
export async function requestUploadAction(
  input: unknown,
): Promise<
  ActionResult<{ url: string; key: string; headers: Record<string, string>; expiresAt: string }>
> {
  return withAction(async () => {
    await requirePermission("product.manage_files");

    const parsed = parseInput(uploadTicketRequestSchema, input);
    const ticket = await fileService.requestUpload(parsed);

    return ok({
      url: ticket.url,
      key: ticket.key,
      headers: ticket.headers,
      expiresAt: ticket.expiresAt.toISOString(),
    });
  });
}

/** Step two — the bytes are up. Everything here is re-checked server-side. */
export async function confirmUploadAction(
  input: unknown,
): Promise<ActionResult<{ fileId: string }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

    const parsed = parseInput(confirmUploadSchema, input);
    const file = await fileService.confirmUpload(
      {
        ...parsed,
        ...(parsed.checksumSha256 ? { checksumSha256: parsed.checksumSha256 } : {}),
      },
      staffActor(staff.user),
    );

    catalogChanged();
    refresh(parsed.productId);

    return ok({ fileId: String(file._id) });
  });
}

export async function removeFileAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ removed: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("product.manage_files");

    const { productId, fileId } = parseInput(fileTarget, parseNestedFormData(formData));
    await fileService.removeFile(fileId, staffActor(staff.user));

    catalogChanged();
    refresh(productId);

    return ok({ removed: true as const });
  });
}

/**
 * A short-lived download URL, for staff checking what they uploaded.
 *
 * Two minutes, not an hour: this one is handed to a browser that already has
 * the page open, so there is no reason for the window to outlive the click.
 * The customer-facing download is ticket 14's, gated by entitlement.
 */
export async function staffDownloadUrlAction(
  fileId: string,
): Promise<ActionResult<{ url: string }>> {
  return withAction(async () => {
    await requirePermission("product.manage_files");

    const parsed = objectIdSchema.safeParse(fileId);
    if (!parsed.success) return fail("That is not a file.", { code: "VALIDATION" });

    const { url } = await fileService.downloadUrlFor(parsed.data, { expiresInSeconds: 120 });
    return ok({ url });
  });
}
