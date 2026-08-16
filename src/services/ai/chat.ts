import "server-only";
import type { AiMessage } from "@/lib/db/models/requests";
import { asAiError, AiUnavailableError, openRouter, withCostAccounting } from "./client";
import { checkAssistantTurn, GUARDRAIL_REPLIES } from "./guardrails";
import { measureTurn, type TurnUsage } from "./usage";
import type { ResolvedAiConfig } from "./settings";

/**
 * One assistant turn, streamed — ticket 16.
 *
 * ## The upstream call is not cancelled when the browser goes away
 *
 * "A conversation survives a page refresh mid-interview" is an acceptance
 * criterion, and the obvious implementation breaks it: pass the request's
 * `AbortSignal` through, the customer refreshes, the completion is cancelled,
 * and the half-generated turn is lost with nothing persisted. They come back to
 * a conversation that has forgotten its own last question.
 *
 * So the browser's disconnect stops the *streaming* and nothing else. The
 * completion runs to the end and the finished turn is persisted, because the
 * expensive part has already been paid for either way and a turn on disk is
 * worth more than a saved half-second of generation.
 *
 * ## The guardrail runs on the complete text, not on deltas
 *
 * A price can straddle a chunk boundary — "£4," then "500". Checking each delta
 * would miss it. So deltas stream to the caller optimistically and the check
 * runs at the end; if it fails, the caller is told to replace what it showed.
 * That is visible to the customer as a message that changes once, which is
 * acceptable, and it is the only ordering that cannot leak the number.
 */

export interface StreamEvents {
  /** A chunk of text, as it arrives. */
  onDelta: (text: string) => void;
  /**
   * The turn finished. `replaced` ⇒ the guardrail withheld the streamed text
   * and `content` is the substitution, so the caller must discard what it
   * displayed rather than append to it.
   */
  onDone: (result: CompletedTurn) => void;
  onError: (error: Error) => void;
}

export interface CompletedTurn {
  message: AiMessage;
  usage: TurnUsage;
  replaced: boolean;
  /** `length` or `content_filter` mean the answer is cut short — §16 criterion. */
  truncated: boolean;
  /** Exactly what the gateway said, for diagnosis. Never shown to a customer. */
  finishReason: string | null;
}

export interface TurnInput {
  config: ResolvedAiConfig;
  /** Full system prompt: stable prefix, then volatile context. */
  system: string;
  /** Prior turns, oldest first. `system` role entries here are ignored. */
  history: readonly Pick<AiMessage, "role" | "content">[];
  userMessage: string;
}

export async function streamAssistantTurn(
  input: TurnInput,
  events: StreamEvents,
): Promise<void> {
  const startedAt = Date.now();

  try {
    const stream = await openRouter().chat.completions.create(
      withCostAccounting({
        model: input.config.model,
        // OpenRouter's own failover: if the primary is down or rate-limited it
        // tries these in order. This is the §104 requirement, and it costs one
        // array rather than a retry loop we would have to write and get wrong.
        ...(input.config.fallbackModels.length
          ? { models: [input.config.model, ...input.config.fallbackModels] }
          : {}),
        temperature: input.config.temperature,
        max_tokens: input.config.maxOutputTokens,
        stream: true,
        // Without this the response carries token counts but no cost, and
        // `usage.ts` has to estimate from the catalogue.
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: input.system },
          ...input.history
            .filter((message) => message.role !== "system")
            .map((message) => ({
              role: message.role as "user" | "assistant",
              content: message.content,
            })),
          { role: "user", content: input.userMessage },
        ],
      }),
    );

    let text = "";
    let finishReason: string | null = null;
    let usage:
      { prompt_tokens?: number; completion_tokens?: number; cost?: number } | undefined;
    let servedBy = input.config.model;

    for await (const chunk of stream) {
      // With failover, the model that answered may not be the one we asked for.
      // Recording the wrong one makes the cost column quietly wrong.
      if (chunk.model) servedBy = chunk.model;

      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (delta) {
        text += delta;
        events.onDelta(delta);
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;

      const chunkUsage = (chunk as { usage?: typeof usage }).usage;
      if (chunkUsage) usage = chunkUsage;
    }

    /*
     * §16 criterion: a `length` or `content_filter` finish must not crash and
     * must not become a silently truncated requirements summary. It is reported
     * so the caller can say so rather than presenting half an answer as whole.
     */
    const truncated = finishReason === "length" || finishReason === "content_filter";

    if (text.trim().length === 0) {
      /*
       * Nothing at all came back. Not an empty turn to persist — that would
       * leave the conversation stuck on a blank bubble.
       *
       * `length` here means the output budget was spent before any prose
       * appeared, which reasoning models do routinely: the thinking consumes
       * the allowance and the answer never starts. That is a configuration
       * problem with one obvious fix, so it is named rather than folded into a
       * generic "the assistant had a problem" that sends an operator looking at
       * the gateway.
       */
      events.onError(
        new AiUnavailableError(
          finishReason === "length"
            ? "The assistant ran out of room before it could answer. Raising the " +
                "maximum response length in AI settings should fix this."
            : "The assistant returned an empty answer.",
          new Error(`empty completion (finish_reason: ${finishReason ?? "none"})`),
        ),
      );
      return;
    }

    const customerText = input.history
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .concat(input.userMessage)
      .join("\n");

    const verdict = checkAssistantTurn(text, customerText);
    const measured = await measureTurn({
      model: servedBy,
      usage,
      latencyMs: Date.now() - startedAt,
    });

    const message: AiMessage = {
      role: "assistant",
      content: verdict.ok ? text : GUARDRAIL_REPLIES[verdict.reason!],
      at: new Date(),
      model: measured.model,
      promptTokens: measured.promptTokens,
      completionTokens: measured.completionTokens,
      costMicros: measured.costMicros,
      // §73's evidence. Staff reviewing the request need to know the assistant
      // tried to quote £9,000, not merely that something was withheld.
      ...(verdict.ok ? {} : { withheldContent: text, withheldReason: verdict.reason! }),
    };

    events.onDone({
      message,
      usage: measured,
      replaced: !verdict.ok,
      truncated,
      finishReason,
    });
  } catch (error) {
    events.onError(asAiError(error));
  }
}
