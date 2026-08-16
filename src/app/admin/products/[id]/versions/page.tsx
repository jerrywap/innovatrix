import type { Metadata } from "next";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { loadVersions } from "@/features/versions/view";
import { NewVersionForm } from "@/features/versions/components/new-version-form";
import { VersionPanel } from "@/features/versions/components/version-panel";
import { nextPatch } from "@/features/versions/suggest";

export const metadata: Metadata = { title: "Versions" };

/**
 * Versions and files — §44, §45.
 *
 * `product.manage_files`, which §77 gives to `content_manager`: preparing a
 * build is not the same act as listing the product, and the same person does
 * not always do both.
 *
 * The newest version is expanded on arrival, because that is the one being
 * worked on. Everything older is collapsed — a product with twenty releases
 * should not open as twenty file tables.
 */
export default async function Page({ params }: PageProps<"/admin/products/[id]/versions">) {
  await requirePermissionOrForbid("product.manage_files");

  const { id } = await params;
  const { product } = await loadWizardProduct(id);
  const versions = await loadVersions(id);

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="versions" />

      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-[13px]">
          {versions.length === 0
            ? "No versions yet. Publishing needs one released version with an application package."
            : `${versions.length} version${versions.length === 1 ? "" : "s"}, newest first.`}
        </p>
        <NewVersionForm productId={product.id} suggested={nextPatch(versions)} />
      </div>

      <div className="flex flex-col gap-3">
        {versions.map((version, index) => (
          <VersionPanel
            key={version.id}
            version={version}
            productId={product.id}
            isCurrent={product.currentVersionId === version.id}
            defaultOpen={index === 0}
          />
        ))}
      </div>

      <div className="border-border flex justify-end border-t pt-4">
        <a
          href={stepHref(product.id, "demo")}
          className="text-[13px] underline underline-offset-4"
        >
          Continue to demo configuration →
        </a>
      </div>
    </div>
  );
}
