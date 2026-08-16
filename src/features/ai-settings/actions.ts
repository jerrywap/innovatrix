"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { parseNestedFormData } from "@/lib/form-data";
import { requirePermission } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { AiSettings } from "@/lib/db/models/requests";
import { staffActor, writeAuditLog } from "@/services/audit";
import { listModels } from "@/services/ai/models";
import { resolveAiConfig } from "@/services/ai/settings";

/**
 * Change which model the assistants use — §104, ticket 16.
 *
 * ## Audited, because it changes behaviour for every customer at once
 *
 * A model swap alters how every conversation reads and what every turn costs.
 * §90 wants that attributable, so the before and after are both recorded — and
 * `ai.configure` is its own permission rather than folded into
 * `settings.manage` for the same reason.
 *
 * ## Still no key
 *
 * There is no field here that accepts a credential and no branch that writes
 * one. `OPENROUTER_API_KEY` stays in the environment; this row says only which
 * model to point at.
 */

const settingsSchema = z.object({
  enabled: z
    .union([z.literal("on"), z.literal("")])
    .optional()
    .transform((value) => value === "on"),
  model: z.string().trim().min(1, "Choose a model").max(120),
  extractionModel: z
    .string()
    .trim()
    .max(120)
    .optional()
    .transform((value) => value || undefined),
  /** Comma or newline separated, so it can be a plain textarea. */
  fallbackModels: z
    .string()
    .trim()
    .max(600)
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(/[,\n]/)
        .map((id) => id.trim())
        .filter(Boolean)
        .slice(0, 5),
    ),
  temperature: z.coerce.number().min(0).max(2),
  maxOutputTokens: z.coerce.number().int().min(128).max(32_000),
});

export async function saveAiSettingsAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ saved: true }>> {
  return withAction(async () => {
    const staff = await requirePermission("ai.configure");
    const parsed = parseInput(settingsSchema, parseNestedFormData(formData));

    /*
     * Reject a model the gateway does not offer, when we can see the catalogue.
     * A typo saves silently otherwise and the next customer conversation fails
     * with a 404 from the gateway that nothing on this screen predicted.
     */
    const catalogue = await listModels();
    if (catalogue.length > 0) {
      const known = new Set(catalogue.map((model) => model.id));
      const unknown = [
        parsed.model,
        ...(parsed.extractionModel ? [parsed.extractionModel] : []),
        ...parsed.fallbackModels,
      ].filter((id) => !known.has(id));

      if (unknown.length > 0) {
        return fail(`OpenRouter does not offer ${unknown.join(", ")}.`, {
          fieldErrors: { model: [`Unknown model: ${unknown.join(", ")}`] },
        });
      }
    }

    const before = await resolveAiConfig();

    await connectToDatabase();
    await AiSettings.findOneAndUpdate(
      { singleton: "global" },
      {
        $set: {
          singleton: "global",
          enabled: parsed.enabled,
          model: parsed.model,
          ...(parsed.extractionModel
            ? { extractionModel: parsed.extractionModel }
            : { extractionModel: undefined }),
          fallbackModels: parsed.fallbackModels,
          temperature: parsed.temperature,
          maxOutputTokens: parsed.maxOutputTokens,
          updatedByUserId: toObjectId(staff.user.id),
        },
      },
      { upsert: true, runValidators: true },
    );

    await writeAuditLog({
      action: "ai_settings.updated",
      actor: staffActor(staff.user),
      // No `subject`: `SubjectType` is the set of things a customer owns, and a
      // global settings singleton is not one of them. Same as
      // `payment_settings.provider_changed`.
      before: {
        enabled: before.enabled,
        model: before.model,
        extractionModel: before.extractionModel,
        fallbackModels: before.fallbackModels,
      },
      after: {
        enabled: parsed.enabled,
        model: parsed.model,
        extractionModel: parsed.extractionModel ?? parsed.model,
        fallbackModels: parsed.fallbackModels,
      },
    });

    revalidatePath("/admin/settings/ai");
    return ok({ saved: true as const });
  });
}
