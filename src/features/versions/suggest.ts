import { compareSemver, parseSemver } from "@/lib/semver";
import type { VersionView } from "./view";

/**
 * A starting point for the next version number.
 *
 * A suggestion, never a rule — whether the next release is a patch, a minor or
 * a major is a judgement about what changed, and the form is free text. This
 * exists so the common case (a patch) is one keystroke rather than five, and so
 * an empty product starts at 1.0.0 rather than at nothing.
 */
export function nextPatch(versions: readonly VersionView[]): string {
  if (versions.length === 0) return "1.0.0";

  const newest = versions.reduce((best, row) =>
    compareSemver(row.version, best.version) > 0 ? row : best,
  );
  const parsed = parseSemver(newest.version);
  if (!parsed) return "1.0.0";

  // A prerelease's "next" is the release it is a candidate for, not a bump —
  // 2.0.0-rc.1 is followed by 2.0.0, not by 2.0.1.
  if (parsed.prerelease.length > 0) {
    return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  }

  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}
