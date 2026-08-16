import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import type { CartItemKind, TaxRuleKind } from "@/lib/db/enums";
import type { TaxRuleDoc } from "@/lib/db/models/commerce";
import { taxRules } from "@/repositories/tax-rule.repository";
import type { TaxInput } from "./calculate";

/**
 * Which tax rule applies — ticket 10's "simple rule engine keyed on the
 * organization's billing country and product type".
 *
 * ## Most specific wins, and the tie-break is explicit
 *
 * A cart can match several rules: a `GB` + `digital` rule, a `GB` + `any` rule,
 * and a `*` catch-all. The order is:
 *
 * 1. **Country over wildcard.** A rule naming `GB` always beats `*`, whatever
 *    the priorities say — otherwise a high-priority catch-all silently
 *    overrides every country rule anybody adds later.
 * 2. **Kind over `any`.** A `digital` rule beats an `any` rule in the same
 *    country.
 * 3. **Then `priority`**, highest first, for genuine ties an administrator
 *    wants to break themselves.
 *
 * Written as an explicit comparator rather than as a sort key, because "most
 * specific" is three rules and encoding them into one number is how a rule set
 * becomes unexplainable.
 *
 * ## No rule means no tax, not an error
 *
 * A country nobody has configured is the normal state of a young platform. It
 * charges no tax and says so; it does not refuse the sale.
 */

export interface TaxContext {
  /** ISO 3166-1 alpha-2, from the organisation's billing address. */
  country: string | undefined;
  /** What is in the cart — a licence is digital, an add-on is a service. */
  kinds: readonly CartItemKind[];
}

/** An add-on is somebody doing work; a licence is a file. §48, and tax law. */
export function taxKindFor(kinds: readonly CartItemKind[]): TaxRuleKind {
  if (kinds.length === 0) return "any";
  // A mixed cart is taxed as digital: the licence is the substance of the
  // purchase and the add-ons hang off it. Splitting the rate per line is a real
  // thing some jurisdictions want, and it is not MVP — flagged in the ticket.
  return kinds.includes("product_licence") ? "digital" : "service";
}

export async function resolveTaxRule(context: TaxContext): Promise<TaxInput | undefined> {
  // Without a billing country there is nothing to key on. That happens before
  // checkout collects an address, which is exactly when the cart is shown —
  // so the cart displays tax-free totals and checkout adds the line.
  if (!context.country) return undefined;

  await connectToDatabase();

  const candidates = await taxRules.candidatesFor(context.country);
  if (candidates.length === 0) return undefined;

  const kind = taxKindFor(context.kinds);
  const winner = pickRule(candidates, context.country.toUpperCase(), kind);

  return winner ? { ruleId: winner.ruleId, basisPoints: winner.basisPoints } : undefined;
}

/** Pure, so the precedence rules above are testable without a database. */
export function pickRule(
  candidates: readonly TaxRuleDoc[],
  country: string,
  kind: TaxRuleKind,
): TaxRuleDoc | undefined {
  const applicable = candidates.filter(
    (rule) =>
      rule.isActive &&
      (rule.country === country || rule.country === "*") &&
      (rule.kind === kind || rule.kind === "any"),
  );

  return applicable.sort((a, b) => {
    const byCountry = specificity(b.country, country) - specificity(a.country, country);
    if (byCountry !== 0) return byCountry;

    const byKind = kindScore(b.kind, kind) - kindScore(a.kind, kind);
    if (byKind !== 0) return byKind;

    if (b.priority !== a.priority) return b.priority - a.priority;

    // A deterministic last resort. Two identical rules is a configuration
    // mistake, but it must not make the total depend on document order.
    return a.ruleId.localeCompare(b.ruleId);
  })[0];
}

const specificity = (ruleCountry: string, country: string) => (ruleCountry === country ? 1 : 0);
const kindScore = (ruleKind: TaxRuleKind, kind: TaxRuleKind) => (ruleKind === kind ? 1 : 0);
