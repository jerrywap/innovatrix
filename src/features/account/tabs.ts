import type { Route } from "next";

/**
 * The account tabs, as data.
 *
 * One list, read by the rail that draws them and by nothing else — but declared
 * apart from the component so the rail stays a presentational island and the
 * order of the tabs is editable without reading JSX.
 *
 * `segment` is what `useSelectedLayoutSegment()` returns for that route: `null`
 * for the index, the folder name below it. Matching on the segment rather than
 * the pathname means a tab cannot mis-highlight because of a trailing slash or a
 * query string.
 */
export interface AccountTab {
  segment: string | null;
  label: string;
  href: Route;
  /** Shown only to somebody who may see the tab. */
  role?: "billing";
}

export const ACCOUNT_TABS: readonly AccountTab[] = [
  { segment: null, label: "Profile", href: "/dashboard/account" },
  { segment: "security", label: "Security", href: "/dashboard/account/security" },
  {
    segment: "notifications",
    label: "Notifications",
    href: "/dashboard/account/notifications",
  },
  {
    segment: "billing",
    label: "Billing",
    href: "/dashboard/account/billing",
    // Drawn only for the roles that may open it. The page guards itself as well —
    // filtering the rail decides what is *shown*, the guard decides what is
    // *allowed*, and the second without the first is merely untidy.
    role: "billing",
  },
];
