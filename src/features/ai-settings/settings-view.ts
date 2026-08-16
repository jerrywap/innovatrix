import "server-only";
import { serverEnv } from "@/config/env";
import { listModels, type AiModelInfo } from "@/services/ai/models";
import { resolveAiConfig } from "@/services/ai/settings";

/**
 * What `/admin/settings/ai` renders — §104, ticket 16.
 *
 * ## No key crosses this boundary
 *
 * Same rule as the payments screen (§88): the view carries a **boolean** for
 * whether `OPENROUTER_API_KEY` is set and the **name** of the variable. The
 * value is reduced to `Boolean(...)` here, server-side, so there is nothing for
 * an RSC payload to leak even by accident.
 *
 * ## Capability is shown, because choosing badly is otherwise silent
 *
 * Requirement extraction needs a model that supports structured output. Pick
 * one that does not and the interview works, the summary step fails, and
 * nothing on this screen said so. Each model is therefore listed with whether
 * it can extract — and the current selection is flagged if it cannot.
 */

export interface AiSettingsView {
  enabled: boolean;
  model: string;
  extractionModel: string;
  fallbackModels: string[];
  temperature: number;
  maxOutputTokens: number;
  source: "database" | "environment";

  keyEnvVar: string;
  keyPresent: boolean;
  envModel: string;

  /** Sorted, priced, with capability. Empty when the catalogue is unreachable. */
  models: AiModelInfo[];
  catalogueAvailable: boolean;

  /** Set when the chosen extraction model cannot do structured output. */
  extractionWarning?: string;
  /** Set when a configured model id is not in the catalogue at all. */
  unknownModels: string[];
}

export async function loadAiSettings(): Promise<AiSettingsView> {
  const env = serverEnv();
  const [config, models] = await Promise.all([resolveAiConfig(), listModels()]);

  const byId = new Map(models.map((model) => [model.id, model]));
  const configured = [config.model, config.extractionModel, ...config.fallbackModels];
  const unknownModels =
    models.length === 0 ? [] : [...new Set(configured)].filter((id) => id && !byId.has(id));

  const extraction = byId.get(config.extractionModel);

  return {
    enabled: config.enabled,
    model: config.model,
    extractionModel: config.extractionModel,
    fallbackModels: config.fallbackModels,
    temperature: config.temperature,
    maxOutputTokens: config.maxOutputTokens,
    source: config.source,

    keyEnvVar: "OPENROUTER_API_KEY",
    // Boolean, deliberately. The value never leaves this function.
    keyPresent: Boolean(env.OPENROUTER_API_KEY),
    envModel: env.OPENROUTER_MODEL,

    models,
    catalogueAvailable: models.length > 0,

    ...(extraction && !extraction.supportsStructuredOutput
      ? {
          extractionWarning:
            `${config.extractionModel} does not support structured output, so turning a ` +
            `conversation into requirements will fall back to tool calling and may fail. ` +
            `Choose a model marked "can extract".`,
        }
      : {}),
    unknownModels,
  };
}
