import "server-only";
import { cache } from "react";
import type { ProductFileDoc, ProductVersionDoc } from "@/lib/db/models/catalog";
import type { ProductFileKind, ProductVersionStatus } from "@/lib/db/enums";
import { connectToDatabase } from "@/lib/db/client";
import { productFiles } from "@/repositories/product-file.repository";
import { listVersions } from "@/services/catalog/version-service";
import { formatDay, toDateInputValue } from "@/lib/dates";

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
  /**
   * Vendor ticket 06 — the mirror/pull source, when there is one.
   *
   * `hasToken` rather than the token: the ciphertext is `select: false` and there is no
   * read path that returns plaintext to a browser. A boolean is the only honest thing to
   * put in a view.
   */
  artefactSource?: {
    status: string;
    url?: string;
    checksumSha256?: string;
    repositoryUrl?: string;
    tag?: string;
    hasToken: boolean;
    lastAttemptAt?: string;
    failureReason?: string;
  };
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
    ...(version.releasedAt ? { releasedAt: formatDay(version.releasedAt) } : {}),
    ...(version.releaseDate ? { releaseDate: toDateInputValue(version.releaseDate) } : {}),
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
    // `hasToken` is derived from the presence of a sealed value, never the value —
    // `tokenCipher` is `select: false`, so a plain read leaves it undefined and this
    // stays honest even if a caller forgets to project it.
    ...(version.artefactSource && version.artefactSource.status
      ? {
          artefactSource: {
            status: version.artefactSource.status,
            ...(version.artefactSource.url ? { url: version.artefactSource.url } : {}),
            ...(version.artefactSource.checksumSha256
              ? { checksumSha256: version.artefactSource.checksumSha256 }
              : {}),
            ...(version.artefactSource.repositoryUrl
              ? { repositoryUrl: version.artefactSource.repositoryUrl }
              : {}),
            ...(version.artefactSource.tag ? { tag: version.artefactSource.tag } : {}),
            hasToken: Boolean(version.artefactSource.tokenCipher?.ciphertext),
            ...(version.artefactSource.lastAttemptAt
              ? { lastAttemptAt: formatDay(version.artefactSource.lastAttemptAt) }
              : {}),
            ...(version.artefactSource.failureReason
              ? { failureReason: version.artefactSource.failureReason }
              : {}),
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
