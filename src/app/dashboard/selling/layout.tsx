import { requireVendorOrNull } from "@/lib/auth/dal";
import { SellingNav } from "@/features/vendors/components/selling-nav";

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
 * ## What this does not do
 *
 * It renders **no `AppShell`** — the customer layout above it already did, and
 * this sits inside that layout's `<main>`. It follows
 * `admin/products/[id]/layout.tsx` instead: guard, then its own `<aside>`.
 *
 * And it does not protect the pages under it. Next.js does not re-run a layout on
 * every navigation, and every action below is a public POST regardless. **No page
 * here may take its vendor scope from this call, or from the enclosing shell's
 * `requireOrg()`** — each one calls `requireVendorOrForbid()` for itself. This
 * call is what makes the chrome correct, and nothing else.
 *
 * `requireVendorOrNull` rather than `requireVendor`: a signed-in customer with no
 * vendor is the normal case, and the useful answer is the application form, which
 * lives under this same segment. The apply page handles the no-vendor state; the
 * nav simply has nothing to draw.
 */
export default async function SellingLayout({ children }: { children: React.ReactNode }) {
  const context = await requireVendorOrNull();

  // Nothing to navigate before there is a vendor, and nothing to navigate while
  // an application is still being decided — an applicant has exactly one screen.
  const showNav = context !== null && context.vendor.status === "verified";

  if (!showNav) return <div className="min-w-0">{children}</div>;

  return (
    <div className="grid gap-6 lg:grid-cols-[200px_1fr]">
      <aside>
        <SellingNav isOwner={context.role === "owner"} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
