import type { LicenceType } from "@/lib/db/enums";

/**
 * What each §65 licence type means, in a sentence a customer can act on.
 *
 * Shared rather than local because it is now read in two places that must not
 * drift: `/pricing`, where somebody decides what to buy, and the licence screen
 * under `/dashboard/software`, where they check what they bought. Those two
 * disagreeing is a support conversation at best and a refund at worst.
 *
 * Deliberately **not** in `enums.ts`. That module is the database's vocabulary
 * and is imported by the proxy and by scripts; this is presentation, and the
 * wording will change for commercial reasons that have nothing to do with the
 * schema. Same instinct as `status-badge.tsx` keeping tone next to the badge
 * rather than next to the enum.
 *
 * Typed `Record<LicenceType, string>` rather than `Record<string, string>` so a
 * new licence type is a compile error here instead of a blank line on a page
 * somebody is reading before paying.
 */
export const LICENCE_COPY: Record<LicenceType, string> = {
  single_project: "One project. Use it in a single client build.",
  single_installation: "One installation. Install it on one site you control.",
  multi_installation: "Several installations, up to the limit on the licence.",
  commercial: "Commercial use, including work you sell on.",
  developer: "Development and staging as well as production.",
  saas: "Run it as a hosted service for your own customers.",
  subscription: "Runs while the subscription does.",
  lifetime: "Yours permanently, with no expiry.",
};

/** The type's own name, for a heading — `multi_installation` → "Multi installation". */
export function licenceTypeLabel(type: LicenceType): string {
  const words = type.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
