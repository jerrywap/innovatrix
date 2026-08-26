import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgRoleOrForbid } from "@/lib/auth/dal";
import { BILLING_ROLES } from "@/features/account/roles";
import { BillingDetailsForm } from "@/features/account/components/billing-form";
import { Panel } from "@/features/account/components/panel";

export const metadata: Metadata = { title: "Billing details" };

/**
 * The address on your invoices.
 *
 * Refuses with a real 403 rather than a redirect, because a `billing`-role
 * customer following a stale link should be told they may not, not silently moved.
 * That is also why there is no `loading.tsx` under `/dashboard/account`:
 * `forbidden()` only produces a 403 if nothing has flushed first, and a boundary
 * over this segment would flush the shell and commit a 200.
 * `loading-boundaries.test.ts` enforces the pair.
 *
 * No `<Suspense>`: `requireOrgRoleOrForbid` has already loaded the organisation
 * in order to know the role, so the form's data is in hand before any JSX. A
 * boundary here would show a skeleton for nothing.
 */
export default async function Page() {
  const { organization } = await requireOrgRoleOrForbid(BILLING_ROLES);

  const address = organization.billingAddress;

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Billing details"
        description="What appears on your invoices. Collected when you first ordered — this is where to correct it."
      >
        <BillingDetailsForm
          defaults={{
            email: organization.billingEmail ?? "",
            line1: address?.line1 ?? "",
            line2: address?.line2 ?? "",
            city: address?.city ?? "",
            region: address?.region ?? "",
            postcode: address?.postcode ?? "",
            country: address?.country ?? "GB",
            taxId: organization.taxId ?? "",
          }}
          currency={organization.defaultCurrency}
        />
      </Panel>

      <p className="text-muted-foreground text-[13px]">
        Past invoices are under{" "}
        <Link href="/dashboard/invoices" className="underline underline-offset-4">
          Invoices
        </Link>
        . Changing an address here does not alter an invoice already issued &mdash; each one
        keeps the details it was raised with.
      </p>
    </div>
  );
}
