import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { loadVersions } from "@/features/versions/view";
import type { VersionActionSet } from "@/features/versions/action-set";
import {
  confirmUploadAction,
  createVersionAction,
  deleteVersionAction,
  deprecateVersionAction,
  releaseVersionAction,
  removeFileAction,
  requestUploadAction,
  staffDownloadUrlAction,
  updateVersionAction,
} from "@/features/versions/actions";
import { NewVersionForm } from "@/features/versions/components/new-version-form";
import { VersionPanel } from "@/features/versions/components/version-panel";
import { nextPatch } from "@/features/versions/suggest";

/**
 * This surface's actions — vendor ticket 06 gave the components two.
 *
 * Declared here rather than in the action module because `"use server"` files may only
 * export async functions, and because a page naming its own set is what stops a
 * component importing an action for the other surface.
 */
const STAFF_VERSION_ACTIONS: VersionActionSet = {
  createVersion: createVersionAction,
  updateVersion: updateVersionAction,
  releaseVersion: releaseVersionAction,
  deprecateVersion: deprecateVersionAction,
  deleteVersion: deleteVersionAction,
  removeFile: removeFileAction,
  requestUpload: requestUploadAction,
  confirmUpload: confirmUploadAction,
  downloadUrl: staffDownloadUrlAction,
};

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
        <NewVersionForm
          actions={STAFF_VERSION_ACTIONS}
          productId={product.id}
          suggested={nextPatch(versions)}
          versionCount={versions.length}
        />
      </div>

      <div className="flex flex-col gap-3">
        {versions.map((version, index) => (
          <VersionPanel
            key={version.id}
            version={version}
            productId={product.id}
            isCurrent={product.currentVersionId === version.id}
            defaultOpen={index === 0}
            actions={STAFF_VERSION_ACTIONS}
          />
        ))}
      </div>

      {/*
        A button, like every other step's continue — this was the one underlined
        text link in the wizard. The label stays honest: nothing on this screen is
        saved by pressing it. Versions save on their own panels, so "Save and
        continue" would claim a save that does not happen.
      */}
      <div className="border-border flex flex-wrap items-center gap-2 border-t pt-5">
        <Button asChild>
          <Link href={stepHref(product.id, "demo")}>Continue to demo configuration</Link>
        </Button>
      </div>
    </div>
  );
}
