import "server-only";
import { findModel } from "./models";

/**
 * What a turn cost — §10.1, "cost per request is a product metric here".
 *
 * ## Two sources, and the gateway's wins
 *
 * OpenRouter returns `usage.cost` when asked for it (`usage: { include: true }`),
 * and that figure is authoritative: it accounts for the actual upstream
 * provider, any routing, and the model's real billing rules. Multiplying tokens
 * by a catalogue price is an *estimate* — right most of the time, wrong for
 * anything with tiered or cached pricing.
 *
 * So: use the gateway's number when it is there, fall back to the catalogue
 * when it is not, and record which happened. A cost column nobody can explain
 * is a cost column nobody trusts.
 *
 * ## Micros, not floats
 *
 * $1e-6 per unit, integer. The same reason order totals are integer minor units
 * (§84): summing thousands of fractions of a cent in binary floating point
 * drifts, and this figure eventually lands next to money that must not.
 */

export interface TurnUsage {
  model: string;
  promptTokens: number;
  completionTokens: number;
  costMicros: number;
  /** `reported` ⇒ the gateway told us; `estimated` ⇒ tokens × catalogue price. */
  costSource: "reported" | "estimated";
  latencyMs: number;
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  /** Dollars, and only present when the request asked for it. */
  cost?: number;
}

export async function measureTurn(input: {
  model: string;
  usage: RawUsage | null | undefined;
  latencyMs: number;
}): Promise<TurnUsage> {
  const promptTokens = input.usage?.prompt_tokens ?? 0;
  const completionTokens = input.usage?.completion_tokens ?? 0;

  /*
   * `> 0`, not merely "present".
   *
   * OpenRouter returns `cost: 0` when the request did not ask for cost
   * accounting (`usage: { include: true }`), and trusting that produced a spend
   * column reading $0.00 next to 9,000 real tokens. A genuinely free model also
   * reports 0 — and for that case the catalogue estimate is 0 too, so falling
   * through costs nothing and rescues the far more likely case.
   */
  if (
    typeof input.usage?.cost === "number" &&
    Number.isFinite(input.usage.cost) &&
    input.usage.cost > 0
  ) {
    return {
      model: input.model,
      promptTokens,
      completionTokens,
      costMicros: Math.round(input.usage.cost * 1e6),
      costSource: "reported",
      latencyMs: input.latencyMs,
    };
  }

  const info = await findModel(input.model);
  const costMicros = info
    ? Math.round(
        promptTokens * info.promptMicrosPerToken +
          completionTokens * info.completionMicrosPerToken,
      )
    : 0;

  return {
    model: input.model,
    promptTokens,
    completionTokens,
    costMicros,
    costSource: "estimated",
    latencyMs: input.latencyMs,
  };
}

/** `costMicros` → a human figure, for the admin screen. Never for invoicing. */
export function formatCostMicros(micros: number): string {
  if (micros === 0) return "$0.00";
  const dollars = micros / 1e6;
  // Sub-cent turns are the common case at flash-model prices, and rounding them
  // all to "$0.00" makes the column useless.
  return dollars < 0.01 ? `$${dollars.toFixed(5)}` : `$${dollars.toFixed(2)}`;
}
