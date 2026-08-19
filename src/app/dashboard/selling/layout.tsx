// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The vendor workspace — vendor ticket 01.
 *
 * ## Why this is a segment and not a fourth app shell
 *
 * A vendor is a third *principal*: `requireOrg()` establishes customer tenancy,
 * `requireStaff()` establishes platform staff, and neither stretches to cover
 * selling. But a new principal does not need a new portal, and the first draft of
 * vendor ticket 01 conflated the two.
 *
 * Every vendor is a signed-up user with a personal organisation, so every vendor
 * already has `/dashboard`. Giving them a second shell means learning which one
 * they are in before they can do anything — and the customer shell already
 * carries an `OrgSwitcher`, so a vendor switcher beside it would make every
 * screen answer "as whom am I acting" first. There is no vendor switcher because
 * there is at most one vendor per user.
 *
 * ## This layout draws nothing, on purpose
 *
 * It used to render its own `<aside>` sub-nav. By vendor ticket 13 the workspace had nine
 * screens, and that aside had become a **second navigation for the same section** — one level
 * down, and invisible until you had already arrived somewhere inside it. A vendor's most common
 * journey is between those screens, so the nav belongs in the shell where it is always visible;
 * `CUSTOMER_NAV`'s "Vendor" group is now the one nav, and this file is what remains.
 *
 * It also does **not** protect the pages under it. Next.js does not re-run a layout on every
 * navigation, and every action below is a public POST regardless. No page here may take its
 * vendor scope from a layout — each one calls `requireVendorOrForbid()` for itself.
 */
export default function SellingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-w-0">{children}</div>;
}
