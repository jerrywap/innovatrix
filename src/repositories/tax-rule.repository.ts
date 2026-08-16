import { BaseRepository } from "./base";
import { TaxRule, type TaxRuleDoc } from "@/lib/db/models/commerce";
import type { TaxRuleKind } from "@/lib/db/enums";

/**
 * Tax rules — ticket 10.
 *
 * The only interesting query is resolution, and it is deliberately a *list*
 * read rather than a clever one-shot: the rule set is tens of rows, it is
 * cached, and picking a winner in code is far easier to reason about — and to
 * test — than expressing "most specific match wins" in a query.
 */
export class TaxRuleRepository extends BaseRepository<TaxRuleDoc> {
  /** Every active rule that could apply to this country, best first. */
  async candidatesFor(country: string): Promise<TaxRuleDoc[]> {
    return this.model
      .find({ isActive: true, country: { $in: [country.toUpperCase(), "*"] } })
      .sort({ priority: -1, country: -1 })
      .limit(50)
      .lean<TaxRuleDoc[]>();
  }

  async findByRuleId(ruleId: string): Promise<TaxRuleDoc | null> {
    return this.model.findOne({ ruleId: ruleId.toLowerCase() }).lean<TaxRuleDoc>();
  }

  async listAll(limit = 200): Promise<TaxRuleDoc[]> {
    return this.model
      .find({})
      .sort({ isActive: -1, country: 1, priority: -1 })
      .limit(limit)
      .lean<TaxRuleDoc[]>();
  }

  async ruleIdExists(ruleId: string, exceptId?: string): Promise<boolean> {
    return this.exists({
      ruleId: ruleId.toLowerCase(),
      ...(exceptId ? { _id: { $ne: exceptId } } : {}),
    });
  }
}

export type { TaxRuleKind };
export const taxRules = new TaxRuleRepository(TaxRule);
