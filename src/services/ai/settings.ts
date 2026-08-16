import "server-only";
import { serverEnv } from "@/config/env";
import { connectToDatabase } from "@/lib/db/client";
import { AiSettings, type AiSettingsDoc } from "@/lib/db/models/requests";

/**
 * Which model to use, resolved once per call.
 *
 * Order is `AiSettings` → `OPENROUTER_MODEL` → the schema default, and the
 * order is the point: an empty database still talks, and an administrator can
 * change model mid-incident without a deploy (§104).
 *
 * **The API key is never here.** It stays in the environment, the settings row
 * holds only *which* model, and `/admin/settings/ai` reports whether the key is
 * present without ever reading its value. Same rule as `PaymentSettings` and
 * for the same reason: a settings row is readable by every administrator and
 * ends up in backups.
 */

export interface ResolvedAiConfig {
  enabled: boolean;
  /** For conversation turns. */
  model: string;
  /** For requirement extraction; equals `model` unless overridden. */
  extractionModel: string;
  /** Passed to OpenRouter as its `models` failover array. */
  fallbackModels: string[];
  temperature: number;
  maxOutputTokens: number;
  /** Where the answer came from, so the admin screen can say so. */
  source: "database" | "environment";
}

export async function resolveAiConfig(): Promise<ResolvedAiConfig> {
  const env = serverEnv();
  await connectToDatabase();

  const row = await AiSettings.findOne({ singleton: "global" }).lean<AiSettingsDoc>();

  if (!row) {
    return {
      enabled: true,
      model: env.OPENROUTER_MODEL,
      extractionModel: env.OPENROUTER_MODEL,
      fallbackModels: [],
      temperature: 0.4,
      maxOutputTokens: 1200,
      source: "environment",
    };
  }

  return {
    enabled: row.enabled,
    model: row.model || env.OPENROUTER_MODEL,
    extractionModel: row.extractionModel || row.model || env.OPENROUTER_MODEL,
    // Never list the primary among its own fallbacks — OpenRouter would retry
    // the model that just failed before trying a different one.
    fallbackModels: (row.fallbackModels ?? []).filter((id) => id && id !== row.model),
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    source: "database",
  };
}

/** The row as the admin screen edits it, created on first save rather than seeded. */
export async function currentSettingsRow(): Promise<AiSettingsDoc | null> {
  await connectToDatabase();
  return AiSettings.findOne({ singleton: "global" }).lean<AiSettingsDoc>();
}
