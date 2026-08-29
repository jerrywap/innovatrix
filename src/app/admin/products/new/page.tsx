import type { Metadata } from "next";
import { aiUnavailableReason } from "@/features/products/ai-availability";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { NewProductForm } from "@/features/products/components/new-product-form";

export const metadata: Metadata = { title: "New product" };

/**
 * Step one — §42's "Create Product".
 *
 * A separate route from the wizard, and gated on a **different permission**.
 * §77 gives `content_manager` `product.update` without `product.create`: they
 * edit the catalogue, they do not add to it. Folding creation into the wizard
 * as "step 1 with a null id" would have collapsed that distinction and made
 * the guard impossible to express.
 *
 * It also solves a schema problem cleanly. `summary` is `required` in Mongoose
 * and `min(10)` in Zod, so a draft cannot exist without one — and because this
 * step collects it, no model relaxation is needed.
 */
export default async function NewProductPage() {
  await requirePermissionOrForbid("product.create");

  const aiUnavailable = await aiUnavailableReason();

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <PageHeader
        title="New product"
        description="Enough to save a draft. Everything else can be filled in afterwards."
        breadcrumbs={[{ label: "Products", href: "/admin/products" }, { label: "New" }]}
      />

      <NewProductForm {...(aiUnavailable ? { aiUnavailable } : {})} />
    </div>
  );
}
