import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";
import { VendorWizardStepper } from "@/features/vendors/components/vendor-wizard-stepper";

/**
 * The vendor product wizard's shell — vendor ticket 04.
 *
 * The staff mirror of this is `admin/products/[id]/layout.tsx` and the two are
 * deliberately the same shape: the product model is the same, so the chrome is too.
 *
 * `loadVendorWizardProduct` is `cache`d on **both** the product and the vendor, so
 * the step page underneath reads the same result rather than issuing its own query —
 * and two vendors in one process cannot share a memoised entry.
 *
 * **This guard does not protect the steps.** Next.js does not re-run a layout on
 * every navigation, and each step's action is a public POST regardless. Every step
 * page calls the DAL for itself and every action re-checks ownership through a scoped
 * write; this call is what makes the chrome correct.
 */
export default async function VendorProductWizardLayout({
  children,
  params,
}: LayoutProps<"/dashboard/selling/products/[id]">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product, readiness } = await loadVendorWizardProduct(id, vendorId);

  const blockedSections = [...new Set(readiness.gaps.map((gap) => gap.section))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={product.name}
        description={product.summary}
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Products", href: "/dashboard/selling/products" },
          { label: product.name },
        ]}
        actions={<StatusBadge status={product.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-5">
          <VendorWizardStepper productId={product.id} blockedSections={blockedSections} />

          {readiness.gaps.length > 0 && product.status !== "published" && (
            <div className="border-border bg-surface-muted/50 rounded-xl border p-3.5">
              <p className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.16em] uppercase">
                Before you submit
              </p>
              <ReadinessGaps gaps={readiness.gaps} productId={product.id} surface="vendor" />
            </div>
          )}
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
