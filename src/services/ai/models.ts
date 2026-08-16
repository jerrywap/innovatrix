import "server-only";
import { serverEnv } from "@/config/env";

/**
 * OpenRouter's model catalogue — price and, crucially, **capability**.
 *
 * ## Why capability is read rather than assumed
 *
 * Ticket 16 specifies structured extraction via
 * `response_format: { type: "json_schema", strict: true }`. Support for that
 * varies by underlying model, and the gateway does not paper over the
 * difference — it forwards it. The default this project shipped with,
 * `anthropic/claude-opus-4.1`, reports neither `response_format` nor
 * `structured_outputs`, so extraction against it would have failed on the
 * configured default and nothing in the code would have said why.
 *
 * So `extract.ts` asks this module what the chosen model can do and picks its
 * strategy, and `/admin/settings/ai` shows the same answer next to each model
 * so an administrator cannot silently select one that cannot extract. That is
 * also what makes ticket 16's last acceptance criterion — swap the model to
 * another vendor and the conversation still runs — true by construction.
 *
 * ## Failure is not fatal
 *
 * If the catalogue cannot be fetched, `capabilityOf` reports "unknown" and
 * callers proceed with the conservative strategy. A gateway that is up enough
 * to answer completions but not `/models` should not take the assistant down.
 */

export interface AiModelInfo {
  id: string;
  name: string;
  contextLength?: number;
  /** Cost in micros ($1e-6) per token, so it multiplies into `costMicros`. */
  promptMicrosPerToken: number;
  completionMicrosPerToken: number;
  supportsStructuredOutput: boolean;
  supportsTools: boolean;
}

interface RawModel {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  pricing?: { prompt?: unknown; completion?: unknown };
  supported_parameters?: unknown;
}

function toInfo(raw: RawModel): AiModelInfo | null {
  if (typeof raw.id !== "string") return null;

  const params = Array.isArray(raw.supported_parameters)
    ? raw.supported_parameters.filter((p): p is string => typeof p === "string")
    : [];

  // Dollars per token in the payload; micros per token here so the arithmetic
  // downstream is integers rather than floats (§84's habit, applied to cost).
  const perToken = (value: unknown) => (typeof value === "string" ? Number(value) : 0) * 1e6;

  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : raw.id,
    ...(typeof raw.context_length === "number" ? { contextLength: raw.context_length } : {}),
    promptMicrosPerToken: perToken(raw.pricing?.prompt),
    completionMicrosPerToken: perToken(raw.pricing?.completion),
    // Both names appear; either one means json_schema is worth attempting.
    supportsStructuredOutput:
      params.includes("structured_outputs") || params.includes("response_format"),
    supportsTools: params.includes("tools"),
  };
}

/**
 * Cached for an hour. The catalogue changes when OpenRouter adds a model, not
 * when we serve a request, and an admin screen that costs an upstream fetch per
 * render is an admin screen nobody opens twice.
 *
 * Plain module-level memoisation rather than `use cache`: this is called from a
 * route handler and from server actions, neither of which is a cached render
 * scope, and the value is process-local and cheap to rebuild.
 */
let cache: { at: number; models: AiModelInfo[] } | undefined;
const TTL_MS = 60 * 60 * 1000;

export async function listModels(options: { force?: boolean } = {}): Promise<AiModelInfo[]> {
  if (!options.force && cache && Date.now() - cache.at < TTL_MS) return cache.models;

  const env = serverEnv();
  if (!env.OPENROUTER_API_KEY) return cache?.models ?? [];

  try {
    const response = await fetch(`${env.OPENROUTER_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      signal: AbortSignal.timeout(15_000),
      cache: "no-store",
    });
    if (!response.ok) return cache?.models ?? [];

    const body = (await response.json()) as { data?: unknown };
    const models = (Array.isArray(body.data) ? body.data : [])
      .map((raw) => toInfo(raw as RawModel))
      .filter((model): model is AiModelInfo => model !== null)
      .sort((a, b) => a.id.localeCompare(b.id));

    cache = { at: Date.now(), models };
    return models;
  } catch {
    // Stale beats absent: an hour-old price list is still a useful admin screen.
    return cache?.models ?? [];
  }
}

export async function findModel(id: string): Promise<AiModelInfo | undefined> {
  return (await listModels()).find((model) => model.id === id);
}

export type StructuredSupport = "yes" | "no" | "unknown";

/**
 * Can this model be asked for a JSON schema directly?
 *
 * `"unknown"` when the catalogue is unavailable — treated by `extract.ts` as
 * "try it and fall back", which is right: a failed attempt costs one request,
 * whereas refusing to try would break extraction whenever `/models` is down.
 */
export async function structuredSupport(modelId: string): Promise<StructuredSupport> {
  const models = await listModels();
  if (models.length === 0) return "unknown";

  const model = models.find((candidate) => candidate.id === modelId);
  if (!model) return "unknown";
  return model.supportsStructuredOutput ? "yes" : "no";
}
