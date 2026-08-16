import "server-only";
import { cache } from "react";
import type { ProductFileDoc, ProductVersionDoc } from "@/lib/db/models/catalog";
import type { ProductFileKind, ProductVersionStatus } from "@/lib/db/enums";
import { connectToDatabase } from "@/lib/db/client";
import { productFiles } from "@/repositories/product-file.repository";
import { listVersions } from "@/services/catalog/version-service";

/**
 * The version list, as the admin screen needs it.
 *
 * A DTO rather than the documents, for the same reason every other view in this
 * codebase is: `ObjectId` and `Date` are not serialisable across the RSC
 * boundary, and a component that receives a Mongoose document has the whole
 * schema available to leak by accident.
 *
 * Files are fetched for **all** versions in one query rather than per version.
 * A product with twenty releases would otherwise issue twenty-one queries to
 * draw one collapsed list.
 */

export interface VersionFileView {
  id: string;
  kind: ProductFileKind;
  kindLabel: string;
  filename: string;
  sizeBytes: number;
  contentType: string;
  checksumSha256?: string;
}

export interface VersionView {
  id: string;
  version: string;
  status: ProductVersionStatus;
  changelog?: string;
  minimumRequirements?: string;
  /** Pre-formatted: an absolute date, per the house rule against relative time. */
  releasedAt?: string;
  releaseDate?: string;
  updateEligibility?: {
    includesPriorMajor: boolean;
    freeFromVersion?: string;
    note?: string;
  };
  files: VersionFileView[];
}

const KIND_LABELS: Record<ProductFileKind, string> = {
  application_package: "Application package",
  source_package: "Source code",
  documentation: "Documentation",
  database: "Database file",
  setup_guide: "Setup guide",
  sample_data: "Sample data",
  asset: "Related asset",
};

export const loadVersions = cache(async (productId: string): Promise<VersionView[]> => {
  await connectToDatabase();

  const versions = await listVersions(productId);
  if (versions.length === 0) return [];

  const files = await productFiles.listForVersions(versions.map((v) => String(v._id)));
  const byVersion = new Map<string, ProductFileDoc[]>();
  for (const file of files) {
    const key = String(file.versionId);
    byVersion.set(key, [...(byVersion.get(key) ?? []), file]);
  }

  return versions.map((version) =>
    toVersionView(version, byVersion.get(String(version._id)) ?? []),
  );
});

function toVersionView(version: ProductVersionDoc, files: ProductFileDoc[]): VersionView {
  return {
    id: String(version._id),
    version: version.version,
    status: version.status,
    ...(version.changelog ? { changelog: version.changelog } : {}),
    ...(version.minimumRequirements
      ? { minimumRequirements: version.minimumRequirements }
      : {}),
    ...(version.releasedAt ? { releasedAt: formatDate(version.releasedAt) } : {}),
    ...(version.releaseDate ? { releaseDate: isoDate(version.releaseDate) } : {}),
    ...(version.updateEligibility
      ? {
          updateEligibility: {
            includesPriorMajor: Boolean(version.updateEligibility.includesPriorMajor),
            ...(version.updateEligibility.freeFromVersion
              ? { freeFromVersion: version.updateEligibility.freeFromVersion }
              : {}),
            ...(version.updateEligibility.note ? { note: version.updateEligibility.note } : {}),
          },
        }
      : {}),
    files: files.map((file) => ({
      id: String(file._id),
      kind: file.kind,
      kindLabel: KIND_LABELS[file.kind] ?? file.kind,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      contentType: file.contentType,
      ...(file.checksumSha256 ? { checksumSha256: file.checksumSha256 } : {}),
    })),
  };
}

/** Absolute, en-GB. Relative time differs between server and client. */
function formatDate(value: Date): string {
  return new Date(value).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** For a `<input type="date">`, which wants `yyyy-mm-dd` and nothing else. */
function isoDate(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
