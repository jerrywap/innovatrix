import { Landmark } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { money, type CurrencyCode } from "@/lib/money";

/**
 * Where to send the money — shown on the confirmation page and on the order.
 *
 * ## The reference is the whole point
 *
 * A transfer arriving with no reference is a transfer nobody can match to an
 * order, and the customer's software sits unreleased while somebody works out
 * whose payment it was. So the reference is rendered large, in mono, above the
 * bank details rather than buried under them.
 *
 * ## It says plainly that nothing is released yet
 *
 * The alternative — letting them assume the order is complete because they saw
 * a confirmation page — produces the support ticket this component exists to
 * prevent. §102's "no fabricated urgency" cuts both ways: no false calm either.
 */
export function TransferInstructions({
  reference,
  total,
  instructions,
}: {
  reference: string;
  total: { amount: number; currency: string };
  instructions: string;
}) {
  return (
    <section className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4">
      <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
        <Landmark className="size-4 text-amber-600" aria-hidden />
        How to pay
      </h2>

      <dl className="border-border mt-3 grid gap-3 border-b pb-3 sm:grid-cols-2">
        <div>
          <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Amount
          </dt>
          <dd className="mt-0.5 text-[15px] font-medium">
            <MoneyDisplay value={money(total.amount, total.currency as CurrencyCode)} />
          </dd>
        </div>
        <div>
          <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
            Reference to quote
          </dt>
          <dd className="mt-0.5 font-mono text-[15px] font-medium">{reference}</dd>
        </div>
      </dl>

      {/* Entered by an administrator as plain text; rendered as plain text.
          `whitespace-pre-wrap` keeps their line breaks without interpreting
          anything, which is the right amount of trust for a settings field. */}
      <p className="mt-3 text-[13px] leading-relaxed whitespace-pre-wrap">{instructions}</p>

      <p className="text-muted-foreground mt-3 text-[12.5px]">
        Your downloads and licence keys are released once we&rsquo;ve received the payment and
        matched it to this order — usually the next working day. We&rsquo;ll email you when that
        happens.
      </p>
    </section>
  );
}
