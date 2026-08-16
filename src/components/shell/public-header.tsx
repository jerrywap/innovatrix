import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "./brand";
import { PUBLIC_NAV } from "@/lib/navigation";
import { getSession } from "@/lib/auth/dal";

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
 */
export function PublicHeader({ account }: { account: React.ReactNode }) {
  return (
    <header className="border-border bg-background/80 sticky top-0 z-50 border-b backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6 px-5 py-3.5 lg:px-10">
        <Brand />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
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
          <Link
            href="/login"
            className="text-muted-foreground hover:text-foreground hidden rounded-full px-3.5 py-2 text-[13.5px] font-medium transition sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/custom-software"
            className="bg-foreground text-background rounded-full px-5 py-2.5 text-[13.5px] font-medium transition hover:opacity-90"
          >
            Get started
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
    <div
      className="bg-surface-muted h-[38px] w-[104px] animate-pulse rounded-full"
      aria-hidden
    />
  );
}
