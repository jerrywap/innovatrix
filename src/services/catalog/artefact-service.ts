import "server-only";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import {
  ProductVersion,
  type ArtefactSource,
  type ProductVersionDoc,
} from "@/lib/db/models/catalog";
import type { DeliveryMethod } from "@/lib/db/enums";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { open, seal } from "@/lib/crypto";
import { log } from "@/lib/logger";
import type { VendorScope } from "@/lib/auth/scope";
import { productFiles } from "@/repositories/product-file.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { assertFetchable, fetchRemoteArtefact } from "@/services/storage/fetcher";
import {
  STORAGE_POLICY,
  assertUploadAllowed,
  productFilePath,
  putObject,
} from "@/services/storage";
import { requireOwnedVersion } from "./ownership";

/**
 * Mirroring and pulling artefacts — vendor ticket 06's other two delivery methods.
 *
 * ## "Vendor-hosted" does not mean the customer downloads from the vendor
 *
 * It means **the vendor's build pipeline is the source**. We fetch once, verify the
 * digest, run the same policy checks an upload gets, and store it in our own bucket;
 * from then on it is an ordinary `ProductFile` and `/api/downloads/[fileId]` serves it
 * exactly as it serves an uploaded one. That is worth stating plainly on the vendor's
 * screen, because it is not what the phrase suggests.
 *
 * The alternative — redirecting a paying customer to a vendor's server — would put
 * §66's licensing guarantee in the hands of somebody whose uptime, retention and
 * access control we do not control. It is also what makes vendor ticket 12's promise
 * possible: a customer who bought never loses what they bought, *because* the bytes
 * are ours.
 *
 * ## And "repository" is a pulled release, not granted access
 *
 * We fetch the tag's tarball and store it. We do **not** invite customers as
 * collaborators on a forge: that is a per-forge OAuth integration, revocation is its
 * own unsolved problem, and it would require the customer to hold an account somewhere
 * they may not. `README.md` names it as deferred.
 *
 * ## The fetch is a job, not a request
 *
 * A 2GB artefact over somebody else's link does not belong in a request lifecycle. So
 * `saveArtefactSource` records the intent and `mirrorArtefact` is what the job calls —
 * with retries, backoff and visible dead-lettering on `/admin/jobs`, because a release
 * whose mirror failed must not look like a release.
 */

/** The scope's cap, so a mirror cannot exceed what an upload could. */
const MAX_ARTEFACT_BYTES = STORAGE_POLICY["product-file"].maxBytes;

export interface SaveArtefactSourceInput {
  versionId: string;
  method: Exclude<DeliveryMethod, "archive">;
  url?: string;
  checksumSha256?: string;
  repositoryUrl?: string;
  tag?: string;
  /** Plaintext, once. Sealed here and never rendered back. */
  token?: string;
}

/**
 * Record where a version's bytes will come from.
 *
 * Validates the URL **now**, with the same `assertFetchable` the job uses, so a vendor
 * who mistypes a host or points at something internal is told while they are looking at
 * the form rather than by a failed job an hour later. One function, so the two answers
 * cannot differ.
 */
export async function saveArtefactSource(
  input: SaveArtefactSourceInput,
  actor: AuditActor,
  scope: VendorScope = {},
): Promise<ProductVersionDoc> {
  await connectToDatabase();

  const { version } = await requireOwnedVersion(input.versionId, scope);

  if (version.status !== "draft") {
    throw new ValidationError(
      `Version ${version.version} is ${version.status}. Its artefact is what customers ` +
        `downloaded and cannot change — ship a correction as a new version.`,
      { status: ["Released versions are permanent."] },
    );
  }

  const source: Partial<ArtefactSource> = { status: "pending" };

  if (input.method === "vendor_hosted") {
    if (!input.url) {
      throw new ValidationError("Where is the package?", { url: ["Required."] });
    }
    if (!/^[a-f0-9]{64}$/i.test(input.checksumSha256 ?? "")) {
      /*
       * Required, not optional. Without it, whatever is at that URL *today* becomes
       * what customers download — and the vendor's own server is the one place in this
       * chain we have no control over. The digest is what turns "trust the URL" into
       * "trust this exact artefact".
       */
      throw new ValidationError("We need the SHA-256 of the file at that address.", {
        checksumSha256: ["64 hex characters. `shasum -a 256 your-package.zip` prints it."],
      });
    }
    await assertFetchable(input.url);
    source.url = input.url;
    source.checksumSha256 = input.checksumSha256!.toLowerCase();
  } else {
    if (!input.repositoryUrl) {
      throw new ValidationError("Which repository?", { repositoryUrl: ["Required."] });
    }
    if (!input.tag?.trim()) {
      throw new ValidationError("Which tag or release?", {
        tag: ["Name the tag to pull — a moving branch is not a release."],
      });
    }
    await assertFetchable(tarballUrlFor(input.repositoryUrl, input.tag));
    source.repositoryUrl = input.repositoryUrl;
    source.tag = input.tag.trim();
  }

  const update: Record<string, unknown> = {
    "artefactSource.status": "pending",
    "artefactSource.url": source.url,
    "artefactSource.checksumSha256": source.checksumSha256,
    "artefactSource.repositoryUrl": source.repositoryUrl,
    "artefactSource.tag": source.tag,
  };

  if (input.token?.trim()) {
    /*
     * Sealed with the version id as AAD, so a `tokenCipher` copied into another
     * version's document fails to open. Same binding demo credentials use, and the
     * same reason: ciphertext that travels is ciphertext that eventually opens
     * somewhere it should not.
     */
    update["artefactSource.tokenCipher"] = seal(input.token.trim(), input.versionId);
  }

  const updated = await ProductVersion.findOneAndUpdate(
    { _id: toObjectId(input.versionId) },
    { $set: update, $unset: { "artefactSource.failureReason": "" } },
    { returnDocument: "after" },
  ).lean<ProductVersionDoc>();

  if (!updated) throw new NotFoundError("version", { id: input.versionId });

  await writeAuditLog({
    action: "product_version.source_set",
    actor,
    subject: { type: "product", id: String(version.productId) },
    // The method and the host, never the token and never the URL's query string.
    after: {
      versionId: input.versionId,
      method: input.method,
      host: hostOf(source.url ?? source.repositoryUrl),
      tag: source.tag,
      hasToken: Boolean(input.token?.trim()),
    },
  });

  return updated;
}

export interface MirrorResult {
  outcome: "stored" | "already_stored" | "failed";
  fileId?: string;
  reason?: string;
}

/**
 * Fetch, verify and store one version's artefact.
 *
 * Called by the job, and idempotent by construction: `status: "stored"` short-circuits,
 * and the storage key is derived from the version so a re-run overwrites in place
 * rather than orphaning — which matters because `s3:DeleteObject` is denied.
 *
 * Every failure is recorded on the version with a reason the vendor can read, and
 * rethrown so the job's backoff sees it. A release whose mirror failed must not look
 * like a release.
 */
export async function mirrorArtefact(
  versionId: string,
  actor: AuditActor,
): Promise<MirrorResult> {
  await connectToDatabase();

  // `+` to defeat `select: false` — this is the one place that may read the token.
  const version = await ProductVersion.findById(versionId)
    .select("+artefactSource.tokenCipher +artefactSource.iv")
    .lean<ProductVersionDoc>();
  if (!version) throw new NotFoundError("version", { id: versionId });

  const source = version.artefactSource;
  if (!source) {
    throw new ValidationError("That version has no artefact source to fetch.");
  }
  if (source.status === "stored") {
    return { outcome: "already_stored" };
  }

  await ProductVersion.updateOne(
    { _id: toObjectId(versionId) },
    {
      $set: { "artefactSource.status": "fetching", "artefactSource.lastAttemptAt": new Date() },
    },
  );

  try {
    const isRepository = Boolean(source.repositoryUrl);
    const url = isRepository
      ? tarballUrlFor(source.repositoryUrl!, source.tag ?? "")
      : source.url!;

    const token = source.tokenCipher ? open(source.tokenCipher, versionId) : undefined;

    const fetched = await fetchRemoteArtefact(url, {
      maxBytes: MAX_ARTEFACT_BYTES,
      // A repository tarball's digest changes with the forge's compression, so only
      // the vendor-hosted method can be held to a declared one.
      ...(source.checksumSha256 ? { expectedSha256: source.checksumSha256 } : {}),
      ...(token ? { token } : {}),
    });

    const filename = isRepository
      ? `${sanitise(source.tag ?? "release")}.tar.gz`
      : filenameFromUrl(url);

    // The identical policy an upload gets: extension allowlist, forbidden extensions,
    // double-extension check, declared type, and the size cap.
    assertUploadAllowed({
      scope: "product-file",
      filename,
      contentType: contentTypeFor(filename, fetched.contentType),
      sizeBytes: fetched.bytes.byteLength,
    });

    const key = productFilePath(String(version.productId), versionId, filename);
    await putObject({
      key,
      body: fetched.bytes,
      contentType: contentTypeFor(filename, fetched.contentType),
    });

    const existing = await productFiles.findByStorageKey(key);
    const file =
      existing ??
      (await productFiles.create({
        productId: version.productId,
        versionId: toObjectId(versionId),
        kind: "application_package",
        storageKey: key,
        filename,
        contentType: contentTypeFor(filename, fetched.contentType),
        sizeBytes: fetched.bytes.byteLength,
        checksumSha256: fetched.sha256,
        scanStatus: "pending",
      }));

    await ProductVersion.updateOne(
      { _id: toObjectId(versionId) },
      {
        $set: { "artefactSource.status": "stored" },
        $unset: { "artefactSource.failureReason": "" },
      },
    );

    await writeAuditLog({
      action: "product_version.artefact_mirrored",
      actor,
      subject: { type: "product", id: String(version.productId) },
      after: {
        versionId,
        host: hostOf(url),
        sizeBytes: fetched.bytes.byteLength,
        sha256: fetched.sha256,
      },
    });

    return { outcome: "stored", fileId: String(file._id) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    await ProductVersion.updateOne(
      { _id: toObjectId(versionId) },
      { $set: { "artefactSource.status": "failed", "artefactSource.failureReason": reason } },
    );

    log.exception("Could not mirror a vendor artefact", error, {
      code: "vendor_artefact.mirror_failed",
      versionId,
    });

    // Rethrown so the job retries with backoff and eventually dead-letters visibly.
    throw error;
  }
}

/**
 * The tarball URL for a tag, per forge.
 *
 * Only GitHub and GitLab, and refusing anything else rather than guessing: a wrong
 * guess is a 404 an hour later in a job, and "we support these two" is a better answer
 * than a URL that might work.
 */
export function tarballUrlFor(repositoryUrl: string, tag: string): string {
  let host: string;
  let path: string;
  try {
    const parsed = new URL(repositoryUrl);
    host = parsed.hostname.toLowerCase();
    path = parsed.pathname.replace(/^\/+|\/+$|\.git$/g, "");
  } catch {
    throw new ValidationError("That is not a repository URL.", {
      repositoryUrl: ["Include https:// and the full path."],
    });
  }

  const safeTag = encodeURIComponent(tag);

  if (host === "github.com" || host === "www.github.com") {
    return `https://codeload.github.com/${path}/tar.gz/refs/tags/${safeTag}`;
  }
  if (host === "gitlab.com" || host === "www.gitlab.com") {
    const project = path.split("/").pop() ?? "release";
    return `https://gitlab.com/${path}/-/archive/${safeTag}/${project}-${safeTag}.tar.gz`;
  }

  throw new ValidationError(
    "We can pull from GitHub and GitLab. For anything else, host the package yourself " +
      "and give us the URL and its checksum.",
    { repositoryUrl: [`${host} is not supported.`] },
  );
}

/** The last path segment, made safe, with a `.zip` fallback. */
function filenameFromUrl(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "package.zip";
  const safe = sanitise(decodeURIComponent(last));
  return /\.[a-z0-9]{1,8}$/i.test(safe) ? safe : `${safe}.zip`;
}

function sanitise(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120) || "package";
}

/**
 * Trust the extension over the server's `Content-Type`.
 *
 * A lot of static hosts answer `application/octet-stream` for everything, which the
 * policy's allowlist would refuse for a perfectly good `.zip`. The extension is what
 * the policy checks anyway, and `verifyUpload`'s magic-byte sniff is what actually
 * decides whether the bytes are what they claim — so this only has to get the pair
 * *consistent*, not correct.
 */
function contentTypeFor(filename: string, served: string): string {
  const extension = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase();
  const byExtension: Record<string, string> = {
    zip: "application/zip",
    gz: "application/gzip",
    tgz: "application/gzip",
    tar: "application/x-tar",
    pdf: "application/pdf",
    sql: "application/sql",
  };
  return (extension && byExtension[extension]) || served || "application/octet-stream";
}

/** The host alone — never a full URL with its query string — for an audit row. */
function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
