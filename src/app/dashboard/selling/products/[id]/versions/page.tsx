import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { StepHeading } from "@/features/products/components/step-heading";

export const metadata: Metadata = { title: "Versions" };

/**
 * Releases and the files customers download — **not built on this surface yet**.
 *
 * The step exists so the rail is complete and so `stepHref(id, "versions", "vendor")`
 * resolves; what is missing is the action layer behind it.
 *
 * ## Why it is deferred rather than half-built
 *
 * Ticket 07's nine version and file actions (`createVersionAction`,
 * `requestUploadAction`, `confirmUploadAction`, `releaseVersionAction`, …) are each
 * gated on a staff permission and each take a bare `versionId` or `fileId` with no
 * ownership predicate — ownership derives through `productId`, so every one needs a
 * scoped lookup adding before a vendor can be let near it. That is the same work
 * **vendor ticket 06** has to do anyway: it owns delivery methods, decides that all
 * three end as a `ProductFile` in our own bucket, and sequences archive-upload first.
 *
 * Doing it here would mean doing it twice, or doing it once and having vendor ticket
 * 06 find it already half-done in a shape it did not choose. So the honest position
 * is: a vendor can author everything about a product except its releases, and cannot
 * submit until a release exists — `computeReadiness()` reports `no_released_version`
 * and `no_package_file`, so the gate says so rather than the screen going quiet.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/versions">) {
  const { vendorId } = await requireVendorOrForbid();

  const { id } = await params;
  const { product } = await loadVendorWizardProduct(id, vendorId);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="versions" />

      <div className="border-border bg-surface-muted/40 rounded-xl border p-5">
        <PageHeader
          title="Releases are not open to vendors yet"
          description="You can fill in everything else in the meantime — it is all saved."
        />
        <p className="text-muted-foreground mt-3 text-[13.5px] leading-relaxed">
          Uploading a release and its files is the next piece of work on this workspace. Until
          it lands, ask us to attach your package and we will add it to{" "}
          <span className="font-medium">{product.name}</span> for you.
        </p>
      </div>
    </div>
  );
}
