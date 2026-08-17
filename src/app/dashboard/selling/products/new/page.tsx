import type { Metadata } from "next";
import { forbidden } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { NewProductForm } from "@/features/products/components/new-product-form";
import { createVendorProductAction } from "@/features/vendors/product-actions";

export const metadata: Metadata = { title: "New product" };

/**
 * A vendor's first step on a new product — vendor ticket 04.
 *
 * A separate route from the wizard for the same reason the staff one is: a draft
 * cannot exist without a summary (`required` in Mongoose, `min(10)` in Zod), and
 * collecting it here means no model relaxation is needed.
 *
 * Ownership is stamped by the action from the session, not collected by this form.
 */
export default async function Page() {
  const { vendor } = await requireVendorOrForbid();

  // Identity verification is the gate on listing a product (vendor ticket 02), and
  // reaching `verified` requires it. Checked here as well as in the action, because a
  // page that offers a form the action will refuse is worse than a refusal.
  if (vendor.status !== "verified") forbidden();

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-6">
      <PageHeader
        title="New product"
        description="Enough to save a draft. Everything else can be filled in afterwards."
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Products", href: "/dashboard/selling/products" },
          { label: "New" },
        ]}
      />

      <NewProductForm action={createVendorProductAction} />
    </div>
  );
}
