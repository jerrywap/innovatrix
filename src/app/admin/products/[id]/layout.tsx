import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { WizardStepper } from "@/features/products/components/wizard-stepper";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";

/**
 * The product wizard's shell — §42.
 *
 * Loads the product once for the whole render. `loadWizardProduct` is wrapped
 * in React `cache`, so the step page underneath reads the same result rather
 * than issuing its own query.
 *
 * **This guard does not protect the steps.** Next.js does not re-run a layout
 * on every navigation, and each step's *action* is a public POST regardless.
 * Every step page calls the DAL for itself and every action re-checks its own
 * permission; this call is what makes the chrome correct.
 */
export default async function ProductWizardLayout({
  children,
  params,
}: LayoutProps<"/admin/products/[id]">) {
  await requirePermissionOrForbid("product.update");

  const { id } = await params;
  const { product, readiness } = await loadWizardProduct(id);

  const blockedSections = [...new Set(readiness.gaps.map((gap) => gap.section))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={product.name}
        description={product.summary}
        breadcrumbs={[{ label: "Products", href: "/admin/products" }, { label: product.name }]}
        // A "View live" link belongs here. The route exists now — it is
        // `/details/[slug]` — so what is left is deciding what it should do for a
        // draft, which has no live page to view. Not this change.
        actions={<StatusBadge status={product.status} />}
      />

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="flex flex-col gap-5">
          <WizardStepper productId={product.id} blockedSections={blockedSections} />

          {readiness.gaps.length > 0 && product.status !== "published" && (
            <div className="border-border bg-surface-muted/50 rounded-xl border p-3.5">
              <p className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.16em] uppercase">
                Before publishing
              </p>
              <ReadinessGaps gaps={readiness.gaps} productId={product.id} />
            </div>
          )}
        </aside>

        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}
