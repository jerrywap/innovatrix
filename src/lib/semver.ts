/**
 * The little bit of semantic versioning this platform actually needs.
 *
 * Not a dependency, because the requirement is narrow and stable: parse
 * `major.minor.patch` with an optional prerelease, compare two of them, and
 * decide whether one release supersedes another. `semver` the package is 40kB
 * to answer three questions, and it accepts a much wider grammar than a release
 * form should — `>=1.2.x || ~3.4` parses cleanly there and is meaningless here.
 *
 * ## Why the ordering has to be right
 *
 * `currentVersionId` only ever moves **forward** (§45). Getting the comparison
 * wrong doesn't throw — it silently points customers at an older download than
 * the one just released, and the symptom appears days later as "the update link
 * gives me the old build". Two places make that class of bug easy:
 *
 * - **Numeric, not lexicographic.** `"10" < "9"` as strings, so a naive
 *   comparison regresses at the tenth release of anything.
 * - **A prerelease sorts *below* its release.** `1.0.0-rc.1 < 1.0.0`, which is
 *   backwards from every other comparison in the file and is exactly what stops
 *   an rc from being handed to customers as the current version.
 */

export interface Semver {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated identifiers after `-`. Empty for a normal release. */
  prerelease: readonly (string | number)[];
  /** Build metadata after `+`. Carried, never compared — that is the spec. */
  build?: string;
  raw: string;
}

/**
 * Deliberately stricter than semver.org's official pattern: three parts are
 * required, and leading zeroes are rejected so `1.01.0` and `1.1.0` cannot both
 * exist as distinct versions of one product.
 */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function parseSemver(value: string): Semver | null {
  const match = SEMVER.exec(value.trim());
  if (!match) return null;

  const [, major, minor, patch, prerelease, build] = match;

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease
      ? prerelease.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
      : [],
    ...(build ? { build } : {}),
    raw: value.trim(),
  };
}

export function isSemver(value: string): boolean {
  return parseSemver(value) !== null;
}

/** `-1` if `a` is older, `1` if newer, `0` if the same precedence. */
export function compareSemver(a: string | Semver, b: string | Semver): number {
  const left = typeof a === "string" ? parseSemver(a) : a;
  const right = typeof b === "string" ? parseSemver(b) : b;

  // An unparseable version sorts below everything rather than throwing: this
  // runs over stored data, and one bad row should not break a version list.
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

/**
 * Spec §11: a version *with* a prerelease has lower precedence than the same
 * version without one, numeric identifiers compare numerically, and a longer
 * set of identifiers wins when every shared identifier is equal.
 */
function comparePrerelease(
  a: readonly (string | number)[],
  b: readonly (string | number)[],
): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (left === right) continue;

    const leftNumeric = typeof left === "number";
    const rightNumeric = typeof right === "number";
    // "Numeric identifiers always have lower precedence than alphanumeric."
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;

    return left < right ? -1 : 1;
  }

  return 0;
}

/** Newest first — the order a version list is read in. */
export function sortByVersionDesc<T>(items: readonly T[], of: (item: T) => string): T[] {
  return [...items].sort((a, b) => compareSemver(of(b), of(a)));
}

/** Is `candidate` strictly newer than `current`? `current` absent means yes. */
export function supersedes(candidate: string, current: string | undefined | null): boolean {
  if (!current) return true;
  return compareSemver(candidate, current) > 0;
}

/**
 * Does an owner of `owned` get `candidate` without paying again?
 *
 * §45's rule, in one place so ticket 14 enforces the same thing the release
 * form recorded. The `updateEligibility` fields come straight off the version.
 *
 * The update *window* is separate and deliberately not here — that is a date
 * comparison against the entitlement, and ticket 14 owns it. This answers only
 * "is this release in scope for that owner's purchase".
 */
export function isFreeUpgrade(
  candidate: string,
  owned: string,
  eligibility: { includesPriorMajor?: boolean; freeFromVersion?: string } | undefined,
): boolean {
  const to = parseSemver(candidate);
  const from = parseSemver(owned);
  if (!to || !from) return false;

  // Never a "free upgrade" to something you already have or have moved past.
  if (compareSemver(to, from) <= 0) return false;

  if (eligibility?.freeFromVersion) {
    // An explicit floor overrides the major-version rule in both directions:
    // it can widen it, and it can narrow it.
    return compareSemver(from, eligibility.freeFromVersion) >= 0;
  }

  if (eligibility?.includesPriorMajor) return true;

  // The default: minor and patch releases are free, a new major is not.
  return to.major === from.major;
}
