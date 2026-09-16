"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireOrg } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { staffActor, writeAuditLog } from "@/services/audit";
import {
  deactivateLicence,
  licenceForEntitlement,
} from "@/services/entitlements/activation-service";
import { setLibraryHidden } from "@/services/entitlements/entitlement-service";

/**
 * Customer actions on their own licence — §65.
 *
 * ## The key never crosses the boundary from the client
 *
 * `releaseActivationAction` takes an **entitlement id and an instance id**, not
 * a licence key. The server resolves the key from the entitlement, which it can
 * only do for an entitlement in the caller's organisation. Accepting a key here
 * would make this endpoint a way to release somebody else's installations by
 * guessing — and the whole point of the key is that it is a credential.
 */

const releaseSchema = z.object({
  entitlementId: objectIdSchema,
  instanceId: z.string().trim().min(1).max(200),
});

export async function releaseActivationAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ released: true }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();
    const input = parseInput(releaseSchema, {
      entitlementId: formData.get("entitlementId"),
      instanceId: formData.get("instanceId"),
    });

    // Scoped: resolves only for an entitlement this organisation owns.
    const licence = await licenceForEntitlement(input.entitlementId, organizationId);
    if (!licence) {
      return fail("We couldn't find that licence.", { code: "NOT_FOUND" });
    }

    const result = await deactivateLicence({
      key: licence.key,
      instanceId: input.instanceId,
    });

    if (!result.valid) {
      return fail(result.message ?? "That installation couldn't be released.", {
        code: "VALIDATION",
      });
    }

    await writeAuditLog({
      action: "licence.activation_released",
      actor: staffActor({ id: user.id, name: user.name }),
      subject: { type: "entitlement", id: input.entitlementId },
      organizationId,
      // The instance id, not the key. An audit log is permanent, and a licence
      // key in one is a credential in one.
      after: { instanceId: input.instanceId, remaining: result.activationsUsed },
    });

    revalidatePath(`/dashboard/software/${input.entitlementId}/licence`);
    return ok({ released: true as const });
  });
}

/* ────────────────────────────────────────────── the library shelf */

const hideSchema = z.object({
  entitlementId: objectIdSchema,
  hidden: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/**
 * Remove a free download from My Purchases, or put it back.
 *
 * ## It does not remove anything
 *
 * The name is the customer's word for it. What happens is a `hiddenAt` stamp on
 * the entitlement, read only by the library listing: the entitlement stands, the
 * licence stands, the append-only download log is untouched (§66), and a link
 * they already have keeps working. Free only, and the service refuses the rest —
 * this action is one caller, and a hidden button is not a control.
 */
export async function setLibraryHiddenAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ hidden: boolean }>> {
  return withAction(async () => {
    const { organizationId } = await requireOrg();
    const input = parseInput(hideSchema, {
      entitlementId: formData.get("entitlementId"),
      hidden: formData.get("hidden"),
    });

    await setLibraryHidden({ ...input, organizationId });

    revalidatePath("/dashboard/software", "layout");
    return ok({ hidden: input.hidden });
  });
}
