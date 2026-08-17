import { MoneyDisplay } from "@/components/money-display";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime, formatDay } from "@/lib/dates";
import { isCurrencyCode, money } from "@/lib/money";
import { STOREFRONT_CURRENCIES } from "@/config/storefront";
import {
  formatRate,
  platformCommissionBasisPoints,
  resolveCommissionForVendor,
} from "@/services/vendors/commission-service";
import { balanceFor, listEntries } from "@/services/vendors/ledger-service";
import { VendorCommissionForm } from "./commission-form";
import { AdjustmentForm } from "./adjustment-form";

/**
 * One vendor's money, for staff — vendor tickets 07 and 08.
 *
 * A **server** component, so the ledger read never crosses to the browser and the two
 * client forms below it stay as small as they can be. It is rendered inside a `<Suspense>`
 * by the page, which is why it may block on three reads without holding the shell.
 *
 * ## Each panel is gated separately
 *
 * The caller passes three booleans rather than a role, because the roles that reach this
 * screen hold different subsets: `marketplace_manager` sets the rate and reads the ledger,
 * `finance` reads it and adjusts it, and neither may do the other's job. The actions
 * re-check every one of these — this only decides what is drawn.
 */
export async function VendorMoney({
  vendorId,
  canReadLedger,
  canManageCommission,
  canAdjust,
}: {
  vendorId: string;
  canReadLedger: boolean;
  canManageCommission: boolean;
  canAdjust: boolean;
}) {
  const [rate, platformBasisPoints, balances, entries] = await Promise.all([
    resolveCommissionForVendor(vendorId),
    platformCommissionBasisPoints(),
    canReadLedger ? balanceFor({ vendorId }) : Promise.resolve([]),
    canReadLedger ? listEntries({ vendorId }, { limit: 25 }) : Promise.resolve([]),
  ]);

  return (
    <section className="flex flex-col gap-5">
      <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Money</h2>

      {canManageCommission && (
        <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-medium">Commission</h3>
            <span className="text-subtle font-mono text-[11px]">
              {formatRate(rate.basisPoints)} ·{" "}
              {rate.source === "vendor" ? "their own rate" : "platform rate"}
            </span>
          </div>
          <VendorCommissionForm
            vendorId={vendorId}
            percent={rate.source === "vendor" ? rate.basisPoints / 100 : null}
            platformPercent={platformBasisPoints / 100}
          />
        </div>
      )}

      {canReadLedger && (
        <div className="border-border flex flex-col gap-4 rounded-xl border p-5">
          <h3 className="text-[14px] font-medium">Balance</h3>

          {balances.length === 0 ? (
            <p className="text-subtle text-[12.5px]">Nothing earned yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {balances
                .filter((b) => isCurrencyCode(b.currency))
                .map((balance) => (
                  <li key={balance.currency} className="flex flex-wrap gap-6 text-[13px]">
                    <Figure
                      label={`${balance.currency} payable`}
                      amount={balance.cleared}
                      currency={balance.currency}
                    />
                    <Figure
                      label="Pending"
                      amount={balance.pending}
                      currency={balance.currency}
                    />
                    <Figure label="Paid" amount={balance.paid} currency={balance.currency} />
                  </li>
                ))}
            </ul>
          )}

          {entries.length > 0 && (
            <ul className="divide-border divide-y text-[13px]">
              {entries.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-2"
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-2">
                      <span className="capitalize">{entry.kind}</span>
                      <StatusBadge status={entry.status} />
                    </span>
                    <span className="text-subtle font-mono text-[11px]">
                      {formatDateTime(entry.createdAt)}
                      {entry.clearsAt ? ` · clears ${formatDay(entry.clearsAt)}` : ""}
                    </span>
                    {/* Attacker-influenced prose only on the adjustment path, which is
                        staff-written. Rendered as text either way. */}
                    {entry.note && <span className="text-muted-foreground">{entry.note}</span>}
                  </span>
                  {isCurrencyCode(entry.amount.currency) && (
                    <MoneyDisplay
                      value={money(entry.amount.amount, entry.amount.currency)}
                      className={entry.amount.amount < 0 ? "text-[var(--danger)]" : undefined}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canAdjust && (
        <div className="border-border flex flex-col gap-3 rounded-xl border p-5">
          <h3 className="text-[14px] font-medium">Adjust the ledger</h3>
          <p className="text-muted-foreground text-[13px]">
            Money created or destroyed on our own authority — a goodwill credit, a chargeback
            fee, a correction. It cannot be edited or removed afterwards; a mistake is fixed
            with an opposite entry, which is what keeps the balance&rsquo;s history readable.
          </p>
          <AdjustmentForm
            vendorId={vendorId}
            defaultCurrency={balances[0]?.currency ?? STOREFRONT_CURRENCIES[0]}
          />
        </div>
      )}
    </section>
  );
}

function Figure({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: number;
  currency: string;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {label}
      </span>
      {isCurrencyCode(currency) ? (
        <MoneyDisplay value={money(amount, currency)} />
      ) : (
        <span className="text-subtle">—</span>
      )}
    </span>
  );
}
