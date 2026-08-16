"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { objectIdSchema } from "@/validators/common";
import { requireUser } from "@/lib/auth/dal";
import { NOTIFICATION_CATEGORIES, NOTIFICATION_CHANNELS } from "@/lib/db/enums";
import {
  ESSENTIAL_CATEGORIES,
  markAllRead,
  markRead,
  setPreference,
} from "@/services/notifications/notification-service";

/**
 * Notification actions — §69.
 *
 * Every one scopes to `requireUser()` and passes that id to the service, which
 * puts it in the query. A notification id in a form is a claim about which row
 * to touch, and on its own it would let anybody mark anybody's bell read.
 */

export async function markReadAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ read: true }>> {
  return withAction(async () => {
    const user = await requireUser();
    const input = parseInput(
      z.object({ notificationId: objectIdSchema }),
      parseNestedFormData(formData),
    );

    await markRead(user.id, input.notificationId);

    revalidatePath("/dashboard/notifications");
    revalidatePath("/staff/notifications");
    // The badge lives in every authenticated shell.
    revalidatePath("/", "layout");

    return ok({ read: true as const });
  });
}

/**
 * No `formData` parameter: the form has no fields, and the recipient comes from
 * the session. `useActionState` still passes the previous state, which this
 * ignores.
 */
export async function markAllReadAction(): Promise<ActionResult<{ cleared: number }>> {
  return withAction(async () => {
    const user = await requireUser();
    const cleared = await markAllRead(user.id);

    revalidatePath("/dashboard/notifications");
    revalidatePath("/staff/notifications");
    revalidatePath("/", "layout");

    return ok({ cleared });
  });
}

/**
 * One switch, per category, per channel.
 *
 * The essential categories are refused server-side as well as hidden in the UI
 * — a checkbox that isn't rendered is still a field somebody can post.
 */
export async function setPreferenceAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const user = await requireUser();

    const input = parseInput(
      z.object({
        category: z.enum(NOTIFICATION_CATEGORIES),
        channel: z.enum(NOTIFICATION_CHANNELS),
        enabled: z
          .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
          .optional()
          .transform((value) => value === "on" || value === "true"),
      }),
      parseNestedFormData(formData),
    );

    if (ESSENTIAL_CATEGORIES.includes(input.category) && !input.enabled) {
      return {
        ok: false as const,
        error: "Payment and security notices can't be turned off.",
        code: "VALIDATION" as const,
      };
    }

    await setPreference({
      userId: user.id,
      category: input.category,
      channel: input.channel,
      enabled: input.enabled,
    });

    revalidatePath("/dashboard/account");
    return ok({ saved: true as const });
  });
}
