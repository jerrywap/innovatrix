/**
 * What a customer may download — §64, §45, ticket 14.
 *
 * **Pure.** No database, no request. This is the rule that decides whether
 * somebody who paid gets a file, and it is the one place it is written — the
 * download route, the My Scripts list and the version history all ask this
 * same function, so what the UI shows and what the server allows cannot drift.
 */

export type DownloadRefusal =
  | "entitlement_suspended"
  | "entitlement_revoked"
  | "version_not_released"
  | "outside_update_window";

export interface EntitlementFacts {
  status: "active" | "suspended" | "revoked";
  /** The version bought. Downloadable forever, whatever the update window says. */
  purchasedVersionId?: string;
  /** Newer releases are included up to here. Absent means none are. */
  updatesUntil?: Date;
}

export interface VersionFacts {
  id: string;
  status: "draft" | "released" | "deprecated";
  releasedAt?: Date;
}

export interface DownloadDecision {
  allowed: boolean;
  refusal?: DownloadRefusal;
  /** Customer-facing, and specific about what to do next. */
  message?: string;
}

const MESSAGES: Record<DownloadRefusal, string> = {
  entitlement_suspended:
    "This licence is suspended while we sort out a payment issue. Get in touch and we'll help.",
  entitlement_revoked: "This licence has been revoked.",
  version_not_released: "That version isn't released yet.",
  outside_update_window:
    "This version came out after your update window ended, so it isn't included in your purchase. " +
    "The version you bought stays available — get in touch if you'd like to extend updates.",
};

/**
 * ## The two rules, and why the second exists
 *
 * 1. The entitlement is `active`.
 * 2. The version was released **on or before `updatesUntil`**, *or* it is the
 *    version originally purchased.
 *
 * That second clause is the one that matters. §45 promises a customer keeps
 * what they bought **permanently** — an update window that lapses stops new
 * releases, it does not repossess the software. Without the purchased-version
 * escape, a customer whose year ran out would lose access to the thing they
 * own, which is not a licensing rule, it is a bug that looks like one.
 */
export function canDownload(
  entitlement: EntitlementFacts,
  version: VersionFacts,
  now: Date = new Date(),
): DownloadDecision {
  if (entitlement.status === "revoked") return refuse("entitlement_revoked");
  if (entitlement.status === "suspended") return refuse("entitlement_suspended");

  // The version they bought. Always theirs, whatever else is true — checked
  // before the window so an expired window cannot take it away.
  if (entitlement.purchasedVersionId && entitlement.purchasedVersionId === version.id) {
    return { allowed: true };
  }

  // A draft is staff work in progress. A *deprecated* version is still
  // downloadable: it was withdrawn from sale, not recalled, and somebody
  // running it in production may legitimately need to reinstall.
  if (version.status === "draft") return refuse("version_not_released");
  if (!version.releasedAt) return refuse("version_not_released");

  if (!entitlement.updatesUntil) return refuse("outside_update_window");
  if (version.releasedAt > entitlement.updatesUntil) return refuse("outside_update_window");

  void now;
  return { allowed: true };
}

/**
 * Is there a newer version this entitlement is entitled to?
 *
 * Drives the "Update available" badge in My Scripts, and the acceptance
 * criterion is that it appears **only when the newer version is genuinely
 * within the update window** — so it runs the same `canDownload` rather than
 * comparing version numbers and hoping.
 */
export function availableUpdate(
  entitlement: EntitlementFacts,
  versions: readonly VersionFacts[],
  compare: (a: string, b: string) => number,
  purchasedVersionNumber?: string,
): VersionFacts | undefined {
  if (entitlement.status !== "active") return undefined;
  if (!purchasedVersionNumber) return undefined;

  const eligible = versions
    .filter((version) => version.status === "released")
    .filter((version) => canDownload(entitlement, version).allowed);

  let newest: VersionFacts | undefined;
  let newestNumber = purchasedVersionNumber;

  for (const version of eligible) {
    const number = (version as VersionFacts & { version?: string }).version;
    if (!number) continue;
    if (compare(number, newestNumber) > 0) {
      newest = version;
      newestNumber = number;
    }
  }

  return newest;
}

/**
 * Is the support window still open?
 *
 * Separate from downloads on purpose: support and updates are sold as separate
 * windows (§65) and expire independently. A customer can be entitled to a
 * download and not to help installing it.
 */
export function hasSupport(supportUntil: Date | undefined, now: Date = new Date()): boolean {
  return Boolean(supportUntil && supportUntil >= now);
}

function refuse(refusal: DownloadRefusal): DownloadDecision {
  return { allowed: false, refusal, message: MESSAGES[refusal] };
}

export { MESSAGES as DOWNLOAD_REFUSAL_MESSAGES };
