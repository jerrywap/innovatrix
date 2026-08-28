import Link from "next/link";
import { Search } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "./brand";
import { MobileNav } from "./mobile-nav";
import { PUBLIC_NAV } from "@/lib/navigation";
import { getSession } from "@/lib/auth/dal";
import { CartBadge } from "@/features/cart/components/cart-badge";
import { HeaderCurrency } from "./header-currency";

/**
 * Marketing header.
 *
 * ## Split in two, and the split is what makes the marketplace prerender
 *
 * Under Cache Components, reading the session makes a component dynamic — and
 * a dynamic *layout* makes every page inside it dynamic. That is what kept
 * `/marketplace` marked `ƒ` instead of `◐` in the build output even after its
 * own body was carefully wrapped in Suspense: the page was fine and the shell
 * above it was not.
 *
 * So the header is static markup with one hole in it. `HeaderAccount` is the
 * only part that touches the session, the layout suspends it, and everything
 * else — the brand, the nav, the theme toggle — prerenders and is in the HTML
 * before any database is consulted.
 *
 * ## Server-rendered rather than client-fetched
 *
 * The account slot still renders on the server. A client-side session fetch
 * would show "Sign in" to a signed-in customer for a beat before correcting
 * itself, which is the flash this used to exist to prevent. Suspense keeps that
 * guarantee: the fallback is a neutral placeholder, never the wrong state.
 *
 * The basket badge shares that slot for the same reason — it reads the cart
 * cookie, so it is dynamic too, and giving it its own boundary would just mean
 * two skeletons resolving a moment apart.
 *
 * ## Below `lg` there was no navigation at all
 *
 * The nav was `hidden md:flex` with nothing behind it, so a phone got the logo,
 * a theme toggle and the account corner — and no way to reach the marketplace.
 * COS-7 hands that case to `MobileNav`, the drawer the dashboard already uses;
 * `PUBLIC_NAV` is passed as a single untitled section because `SidebarNav` draws
 * no heading without one.
 *
 * The breakpoint is `xl`, not the `md` this used to be. Four labels — "Software &
 * Scripts", "Website Templates", "Request Custom Build", "Sell" — plus the theme
 * toggle and the account corner measure about 1,070px, so below `xl` the row wraps
 * to two lines. A drawer is better than a wrapped nav, and `MobileNav`'s trigger
 * takes the matching `xl:hidden` so exactly one of the two is ever visible.
 */
export function PublicHeader({ account }: { account: React.ReactNode }) {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-50 border-b backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-5 py-3.5 lg:px-10">
        <div className="flex items-center gap-2.5">
          <MobileNav sections={[{ items: PUBLIC_NAV }]} triggerClassName="xl:hidden" />
          <Brand />
        </div>

        <nav className="hidden items-center gap-1 xl:flex" aria-label="Main">
          {PUBLIC_NAV.map(({ label, href }) => (
            <Link
              key={label}
              href={href}
              className="text-muted-foreground hover:bg-surface-muted hover:text-foreground rounded-full px-3.5 py-2 text-[13.5px] font-medium transition"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/*
            Search, before the theme switch.

            Static markup, so it costs the header nothing — it reads no cookie
            and no session, unlike the two controls after it, and stays outside
            the one dynamic hole.

            Icon-only with an `sr-only` name: the nav beside it already carries
            four text labels and a fifth is what pushed this row to `xl` in the
            first place. Visible at every width, because a phone's nav is behind
            a burger and search is the one thing nobody should have to open a
            drawer to reach.
          */}
          <Link
            href="/search"
            aria-label="Search"
            className="border-border hover:bg-surface-muted focus-visible:ring-ring grid size-9 shrink-0 place-items-center rounded-full border transition focus-visible:ring-2 focus-visible:outline-none"
          >
            <Search className="size-4" aria-hidden />
          </Link>

          <ThemeToggle className="hidden sm:flex" />
          {account}
        </div>
      </div>
    </header>
  );
}

/**
 * The session-dependent corner of the header.
 *
 * Staff get a link to their own surface, because staff browse the public
 * marketplace too and otherwise have to remember the URL.
 */
export async function HeaderAccount() {
  const session = await getSession();
  const signedIn = Boolean(session);
  const isStaff = session?.user.isStaff ?? false;

  return (
    <>
      {/* Inside the same boundary as the session, because both are dynamic and
          a second Suspense here would mean two skeletons popping in a row. */}
      <CartBadge />

      {/*
        Just after the basket — which for most visitors means *first*, because
        `CartBadge` renders nothing when the basket is empty. That is correct
        rather than a gap to paper over: the order is
        `[theme] · [cart?] · currency · [staff] · CTA` either way.

        Here rather than in the static markup for the same reason as the badge:
        it reads the cookie and the forwarded URL, and a dynamic read outside
        this boundary would make the whole layout dynamic. See `HeaderCurrency`.
      */}
      <HeaderCurrency />

      {isStaff && (
        <Link
          href="/staff"
          className="text-muted-foreground hover:text-foreground hidden rounded-full px-3.5 py-2 text-[13.5px] font-medium transition lg:block"
        >
          Staff
        </Link>
      )}

      {signedIn ? (
        <Link
          href="/dashboard"
          className="bg-foreground text-background rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90"
        >
          Dashboard
        </Link>
      ) : (
        <>
          {/*
          One control, not two.

          "Get started" pointed at `/custom-software`, which is a *destination*
          rather than an account action — so the signed-out corner offered a
          quiet "Sign in" beside a loud button that did not sign anyone in. The
          nav already carries "Request Custom Build", and the hero offers it
          three more times.

          `Sign in` loses its `sm:` gate along with it. It was hidden on phones
          because the filled button was there to catch the tap; with that gone,
          hiding it would leave a signed-out phone visitor no way into an
          account from the header at all.
        */}
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground rounded-full px-3.5 py-2 text-[13.5px] font-medium transition"
          >
            Sign in
          </Link>
        </>
      )}
    </>
  );
}

/**
 * What sits in the account slot while the session resolves.
 *
 * Sized to match the real button so the header does not reflow when it
 * arrives — a shifting header is the most visible layout shift a page can have,
 * because it is the first thing anyone looks at.
 */
export function HeaderAccountFallback() {
  return (
    <div className="flex items-center gap-2" aria-hidden>
      {/* The currency pill and the account CTA. The basket is deliberately
          unreserved: it is conditional, and reserving for it would shift the
          header the *other* way for the majority who have no basket. */}
      <div className="bg-surface-muted h-9 w-[62px] animate-pulse rounded-full" />
      <div className="bg-surface-muted h-[38px] w-[104px] animate-pulse rounded-full" />
    </div>
  );
}
