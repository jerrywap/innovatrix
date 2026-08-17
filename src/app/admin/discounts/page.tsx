import type { Metadata } from "next";
import { Suspense } from "react";
import { Tag } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { MoneyDisplay } from "@/components/money-display";
import { Skeleton } from "@/components/ui/skeleton";
import { money, type CurrencyCode } from "@/lib/money";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { discountCodes } from "@/repositories/discount-code.repository";
import { DiscountForm } from "@/features/pricing/components/discount-form";
import { ToggleActive } from "@/features/pricing/components/toggle-active";
import { setDiscountActiveAction } from "@/features/pricing/actions";
import { formatDay } from "@/lib/dates";

export const metadata: Metadata = { title: "Discounts" };

/**
 * Discount codes — ticket 10.
 *
 * Deactivating never deletes: a code on a two-year-old order must still resolve
 * when support looks at it, and `usedCount` is the record of how many times it
 * was actually claimed.
 */
export default async function Page() {
  await requirePermissionOrForbid("discount.manage");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Discounts"
        description="Codes customers can apply at checkout. Validated again on every recalculation, so an expired one is caught before payment."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Codes />
      </Suspense>
    </div>
  );
}

async function Codes() {
  await connectToDatabase();
  const codes = await discountCodes.listActive(100);

  return (
    <div className="flex flex-col gap-8">
      <DiscountForm />

      {codes.length === 0 ? (
        <EmptyState
          icon={Tag}
          title="No discount codes yet"
          description="Create one above and it becomes available at checkout immediately."
        />
      ) : (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {codes.map((code) => (
            <li key={String(code._id)} className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2">
                  <span className="font-mono text-[13.5px] font-medium">{code.code}</span>
                  <span className="text-subtle text-[12px]">
                    {code.kind === "percentage" ? (
                      `${code.value / 100}% off`
                    ) : (
                      <>
                        <MoneyDisplay
                          value={money(code.value, (code.currency ?? "GBP") as CurrencyCode)}
                        />{" "}
                        off
                      </>
                    )}
                  </span>
                  {!code.isActive && (
                    <span className="text-subtle rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                      inactive
                    </span>
                  )}
                </p>
                <p className="text-subtle text-[12px]">
                  {[
                    code.description,
                    code.usageLimit !== undefined
                      ? `${code.usedCount}/${code.usageLimit} claimed`
                      : `${code.usedCount} claimed`,
                    code.minSpend
                      ? `min spend ${code.minSpend.amount / 100} ${code.minSpend.currency}`
                      : undefined,
                    code.categorySlugs.length > 0
                      ? `categories: ${code.categorySlugs.join(", ")}`
                      : undefined,
                    code.expiresAt ? `expires ${formatDay(code.expiresAt)}` : undefined,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <ToggleActive
                id={String(code._id)}
                isActive={code.isActive}
                action={setDiscountActiveAction}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
