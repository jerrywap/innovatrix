"use server";

import { revalidatePath } from "next/cache";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { toggleSaved } from "@/services/marketplace/saved";

/**
 * Save / unsave a product — §6.
 *
 * `requireUser`, not `requirePermission`: a bookmark needs an account and
 * nothing more. And it needs the account rather than the *organisation*,
 * because a save is personal — see `SavedProductDoc`.
 *
 * The action is the authorisation boundary, not the button. A hidden or
 * disabled save button is cosmetic; this is a public POST endpoint and
 * `requireUser` is what actually stops an anonymous caller writing rows.
 */
export async function toggleSavedAction(
  productId: string,
): Promise<ActionResult<{ saved: boolean }>> {
  return withAction(async () => {
    const user = await requireUser();
    const id = parseInput(objectIdSchema, productId);

    const result = await toggleSaved(user.id, id);
    revalidatePath("/dashboard/saved");

    return ok(result);
  });
}
