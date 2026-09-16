import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { requireVerifiedVendorOrForbid } from "@/lib/auth/dal";
import { loadVendorWizardProduct } from "@/features/products/wizard";
import { stepHref } from "@/features/products/steps";
import { StepHeading } from "@/features/products/components/step-heading";
import { loadVersions } from "@/features/versions/view";
import { nextPatch } from "@/features/versions/suggest";
import { NewVersionForm } from "@/features/versions/components/new-version-form";
import { VersionPanel } from "@/features/versions/components/version-panel";
import { DeliverySource } from "@/features/vendors/components/delivery-source";
import type { VersionActionSet } from "@/features/versions/action-set";
import {
  confirmVendorUploadAction,
  createVendorVersionAction,
  deleteVendorVersionAction,
  deprecateVendorVersionAction,
  releaseVendorVersionAction,
  removeVendorFileAction,
  requestVendorUploadAction,
  updateVendorVersionAction,
  vendorDownloadUrlAction,
} from "@/features/vendors/version-actions";

/**
 * This surface's actions. Every one is vendor-guarded and vendor-scoped; the
 * components are the staff ones because the model is the same.
 */
const VENDOR_VERSION_ACTIONS: VersionActionSet = {
  createVersion: createVendorVersionAction,
  updateVersion: updateVendorVersionAction,
  releaseVersion: releaseVendorVersionAction,
  deprecateVersion: deprecateVendorVersionAction,
  deleteVersion: deleteVendorVersionAction,
  removeFile: removeVendorFileAction,
  requestUpload: requestVendorUploadAction,
  confirmUpload: confirmVendorUploadAction,
  downloadUrl: vendorDownloadUrlAction,
};

export const metadata: Metadata = { title: "Versions" };

/**
 * A vendor's releases and files — vendor ticket 06, the **archive** method.
 *
 * The customer's download path is unchanged and must be: `/api/downloads/[fileId]`
 * authorises, records, and 307s to a five-minute signed URL. Every delivery method
 * ends as a `ProductFile` in our own bucket before a customer asks, so a customer
 * cannot tell which of the three a vendor used — and §66's guarantee never depends on
 * somebody else's uptime.
 *
 * A released version is frozen. "I bought 2.4.0" has to keep meaning something, so a
 * correction ships as 2.4.1 — the upload and delete controls disappear once released
 * and the service refuses either way.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/products/[id]/versions">) {
  const { vendorId } = await requireVerifiedVendorOrForbid();

  const { id } = await params;
  const { product } = await loadVendorWizardProduct(id, vendorId);
  const versions = await loadVersions(id);

  // Absent means `archive`, which is what a vendor gets by default and what every
  // first-party product uses.
  const method = product.deliveryMethod ?? "archive";

  return (
    <div className="flex flex-col gap-6">
      <StepHeading section="versions" />

      <p className="text-muted-foreground text-[13px]">
        {versions.length === 0
          ? "A product needs one released version with an application package before it can be submitted."
          : `${versions.length} version${versions.length === 1 ? "" : "s"}.`}
      </p>

      {/*
        The delivery method is a fieldset of the form now rather than its own
        save — see `NewVersionForm`. It is still a product field; what changed is
        that a vendor states it once, alongside the version it applies to.
      */}
      <NewVersionForm
        actions={VENDOR_VERSION_ACTIONS}
        productId={product.id}
        suggested={nextPatch(versions)}
        method={method}
        versionCount={versions.length}
      />

      <div className="flex flex-col gap-3">
        {versions.map((version, index) => (
          <VersionPanel
            key={version.id}
            version={version}
            productId={product.id}
            isCurrent={product.currentVersionId === version.id}
            defaultOpen={index === 0}
            actions={VENDOR_VERSION_ACTIONS}
            deliverySlot={
              method === "archive" ? undefined : (
                <DeliverySource
                  productId={product.id}
                  versionId={version.id}
                  method={method}
                  {...(version.artefactSource ? { source: version.artefactSource } : {})}
                  editable={version.status === "draft"}
                />
              )
            }
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
          <Link href={stepHref(product.id, "demo", "vendor")}>
            Continue to demo configuration
          </Link>
        </Button>
      </div>
    </div>
  );
}
