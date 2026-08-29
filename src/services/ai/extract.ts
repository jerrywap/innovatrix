import "server-only";
import type { z } from "zod";
import { asAiError, openRouter, withCostAccounting } from "./client";
import { structuredSupport } from "./models";
import { measureTurn, type TurnUsage } from "./usage";
import type { ResolvedAiConfig } from "./settings";

/**
 * Turn a conversation into a structured object — ticket 16.
 *
 * ## The Zod parse is the guarantee, not the gateway's promise
 *
 * `response_format: { type: "json_schema", strict: true }` is honoured to
 * varying degrees depending on the model behind the gateway. So the schema goes
 * to the model *and* the result is parsed against it here. If those two ever
 * disagree, the parse wins and the caller degrades — the alternative is saving
 * a plausible-looking object with a missing field that surfaces three screens
 * later as a crash.
 *
 * **Never regex a model's prose.** The failure mode of a regex over free text
 * is a partially-correct requirements list, which is worse than none: it looks
 * like the customer asked for something they did not.
 *
 * ## Two strategies, chosen from capability rather than hope
 *
 * `models.ts` reports whether the chosen model supports structured output. If
 * it does, we ask for a schema. If it does not — the state the previous default
 * `anthropic/claude-opus-4.1` was in — we ask for a tool call instead, which is
 * far more widely supported and gets the same job done. `"unknown"` tries the
 * schema first, because a wasted attempt costs one request and refusing to try
 * would break extraction whenever the model catalogue is unreachable.
 */

export interface ExtractionResult<T> {
  data: T;
  usage: TurnUsage;
  strategy: "json_schema" | "tool_call";
  /** True when the first attempt produced something the schema rejected. */
  retried: boolean;
}

export class ExtractionFailedError extends Error {
  constructor(
    message: string,
    readonly detail: string,
  ) {
    super(message);
    this.name = "ExtractionFailedError";
  }
}

export interface ExtractInput<T> {
  config: ResolvedAiConfig;
  /** JSON Schema handed to the model. Must match `schema`. */
  jsonSchema: Record<string, unknown>;
  schemaName: string;
  /** The Zod schema that actually decides. */
  schema: z.ZodType<T>;
  system: string;
  /** The transcript, or whatever the extraction should read. */
  input: string;
  /**
   * Overrides the deterministic default — see the note beside `temperature` in
   * `attempt()`. Extraction leaves this alone; rewriting prose does not.
   */
  temperature?: number;
}

export async function extractStructured<T>(
  input: ExtractInput<T>,
): Promise<ExtractionResult<T>> {
  const model = input.config.extractionModel;
  const support = await structuredSupport(model);
  const first: "json_schema" | "tool_call" = support === "no" ? "tool_call" : "json_schema";

  try {
    return await attempt(input, model, first, false);
  } catch (error) {
    if (!(error instanceof ExtractionFailedError)) throw asAiError(error);

    /*
     * One retry, and deliberately with the *other* strategy rather than the
     * same one again. A model that ignored the schema once will usually ignore
     * it twice; a model that cannot do schemas at all is exactly the case the
     * catalogue said "unknown" about. Switching is the retry that has a reason
     * to work.
     */
    const second = first === "json_schema" ? "tool_call" : "json_schema";
    return attempt(input, model, second, true);
  }
}

async function attempt<T>(
  input: ExtractInput<T>,
  model: string,
  strategy: "json_schema" | "tool_call",
  retried: boolean,
): Promise<ExtractionResult<T>> {
  const startedAt = Date.now();

  const common = {
    model,
    ...(input.config.fallbackModels.length
      ? { models: [model, ...input.config.fallbackModels] }
      : {}),
    /*
     * Extraction is not creative writing. The same transcript should produce
     * the same requirements twice running.
     *
     * Overridable, because one caller is not extracting. `authoring.ts` rewrites
     * a vendor's own prose, where determinism is the wrong goal — pressing
     * "Enhance" twice and getting the identical sentence back reads as a broken
     * button rather than a stable one. It passes the configured temperature;
     * everything else here still gets `0` by omission.
     */
    temperature: input.temperature ?? 0,
    max_tokens: input.config.maxOutputTokens,
    messages: [
      { role: "system" as const, content: input.system },
      { role: "user" as const, content: input.input },
    ],
  };

  const response =
    strategy === "json_schema"
      ? await openRouter().chat.completions.create(
          withCostAccounting({
            ...common,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: input.schemaName,
                strict: true,
                schema: input.jsonSchema,
              },
            },
          }),
        )
      : await openRouter().chat.completions.create(
          withCostAccounting({
            ...common,
            tools: [
              {
                type: "function",
                function: {
                  name: input.schemaName,
                  description: "Record the structured result.",
                  parameters: input.jsonSchema,
                },
              },
            ],
            // Force it: left to choose, a model will often reply in prose and
            // the tool call never happens.
            tool_choice: {
              type: "function",
              function: { name: input.schemaName },
            },
          }),
        );

  const choice = response.choices?.[0];
  const raw =
    strategy === "json_schema"
      ? choice?.message?.content
      : choice?.message?.tool_calls?.[0]?.type === "function"
        ? choice.message.tool_calls[0].function.arguments
        : undefined;

  if (!raw) {
    throw new ExtractionFailedError(
      "The assistant did not return a result.",
      `strategy=${strategy} finish_reason=${choice?.finish_reason ?? "none"}`,
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    throw new ExtractionFailedError(
      "The assistant's answer was not readable.",
      `strategy=${strategy} not-json: ${raw.slice(0, 200)}`,
    );
  }

  const result = input.schema.safeParse(parsedJson);
  if (!result.success) {
    throw new ExtractionFailedError(
      "The assistant's answer was incomplete.",
      `strategy=${strategy} zod: ${result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")
        .slice(0, 300)}`,
    );
  }

  return {
    data: result.data,
    usage: await measureTurn({
      model: response.model || model,
      usage: response.usage,
      latencyMs: Date.now() - startedAt,
    }),
    strategy,
    retried,
  };
}
