import Image from "next/image";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "@/components/shell/brand";
import { BRAND } from "@/config/brand";
import { AuthAside } from "@/features/auth/components/auth-aside";

/**
 * A supplied brand asset, in `public/brand/` beside the hero's own — not product
 * media and not object storage, for the reason `data.ts` gives about the others:
 * it ships with the app and is part of the brand rather than part of the
 * catalogue. Re-encoded from the 262KB original to 50KB, which is all a veiled
 * background needs.
 */
const AUTH_BACKGROUND = "/brand/auth-studio.jpg";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * The `(auth)` shell — a route group, so it adds a layout without adding a URL
 * segment: these pages stay at `/login`, `/register` and so on.
 *
 * Deliberately narrow and chrome-free. Every other surface has navigation; this
 * one has exactly one job, and a nav bar full of links is an invitation to
 * abandon it half-finished.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  /*
   * `min-h-dvh`, not `min-h-full`.
   *
   * `min-h-full` is `min-height: 100%`, which resolves against the parent's
   * *content* height — and the parent is a flex column whose height comes
   * from its content, so the percentage had nothing definite to resolve
   * against and the shell sat short of the viewport. It never showed while
   * every card was tall enough to fill the page on its own; the short ones
   * (a spent reset link, "you're all set") left the footer floating
   * mid-screen with the fold below it.
   *
   * `dvh` measures the viewport directly, so there is no chain to break, and
   * it follows a phone's shrinking toolbar rather than the static `vh`.
   */
  return (
    <div className="bg-background relative flex min-h-dvh flex-col">
      {/*
        The photograph, veiled — and it replaces the grid rather than joining it.

        Two textures competing over one 420px form is noise; the picture does the
        job the grid was doing, and does it with something to say.

        ## The asset is built for this layout

        Its left half is bare plaster and its right half is the desk, which is the
        same split the columns below make: the form lands on the calm side and the
        photograph sits behind the panel. So `object-center` at `lg`, which shows
        the frame whole rather than cropping to either half.

        On a phone the aspect ratio inverts and `object-cover` would crop hard to
        the middle — straight through the join. `object-[30%_center]` puts the
        plaster behind the form instead, which is the only part of the frame a
        narrow viewport can hold and still be calm.

        ## Why it is veiled this heavily

        Two reasons that happen to want the same thing. Text over a photograph has
        no contrast guarantee, and this page is nothing but text and inputs — the
        hero solves the identical problem with `bg-background/78` on phones, and
        this is that treatment applied at every width. And the source is 688px
        wide, so at full bleed it is upscaled about twofold; at this opacity the
        softness reads as atmosphere rather than as a photograph that has been
        stretched.

        Dark gets `opacity-[0.18]` on the image itself, not just a darker veil.
        The picture is a bright, warm, high-key room: dimmed by a wash alone it
        stays a glowing rectangle behind a dark page. The hero reaches for the
        same `dark:opacity` for the same reason.
      */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <Image
          src={AUTH_BACKGROUND}
          alt=""
          fill
          sizes="100vw"
          // Behind the only content on the route, so it is fetched with the
          // document rather than after it.
          priority
          /*
            Mirrored, and that is a contrast decision rather than a compositional
            one.

            The asset is plaster on the left and the desk on the right. Left as
            shot, the desk lands behind the panel — which is bare text — and the
            plaster lands behind the form, which sits on an *opaque* card and did
            not need the help. Measured: the darkest pixel behind the panel text
            is `rgb(10 9 6)`, and body copy over it reached 2.9:1. Veiling hard
            enough to fix that (0.90) still only reached 4.35:1 and erased the
            photograph on the way.

            Flipped, each half is under the thing that suits it: the photograph
            goes behind the card, which covers it completely, and the plaster —
            darkest pixel `rgb(182 170 158)`, and near-uniform — goes behind the
            text. Nothing else in the frame has to change.
          */
          className="scale-x-[-1] object-cover object-[70%_center] lg:object-center dark:opacity-[0.18]"
        />

        {/* The veil. Both themes, because both need it — see above. */}
        <div className="bg-background/74 dark:bg-background/70 absolute inset-0" />

        {/*
          A little more over the panel, which is the half that is bare text.

          Plaster under the 74% veil measures 4.49:1 for body copy — right on
          AA's line and therefore not over it. This carries it clear without
          touching the half where the photograph is doing its work.
        */}
        <div className="from-background absolute inset-0 bg-gradient-to-l from-15% to-transparent to-70%" />

        {/*
          And along the bottom, for the footer.

          "Terms · Privacy" is `--subtle` at 12.5px — small text, so it owes
          4.5:1 — and it sits centred over the desk, where it measured 2.8:1. The
          hero ends its photograph the same way and for the same reason: a
          picture should never end on a line, and text should never end on a
          picture.
        */}
        <div className="to-background absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-5 py-5 lg:px-10">
        {/*
          `<Brand>` rather than a hand-rolled copy of it. This header carried its
          own lockup until the rebrand, which is exactly the drift `brand.tsx`
          claims to prevent — and it had drifted: a different mark, a different
          size, and mixed case where the shells used caps.
        */}
        <Brand />
        <ThemeToggle />
      </header>

      {/*
        Two columns at `lg`, one below it.

        The form keeps its own 420px column at every width and its markup is
        untouched — the panel is a sibling, not a wrapper, so nothing about how
        these six pages submit has changed.

        `lg:items-center` with the pair in a grid rather than a flex row: the two
        columns have very different heights (a reset form is a third of the
        register form) and a grid centres each against the other rather than
        stretching one to match. `max-w-[1100px]` because the gap reads as a
        gutter up to about there and as an ocean past it.

        Below `lg` the panel is gone entirely rather than stacked underneath.
        Anything below the form on a phone is under the fold and under the
        keyboard; the page has one job, and the panel is not it.
      */}
      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10">
        <div className="grid w-full max-w-[420px] items-center gap-14 lg:max-w-[960px] lg:grid-cols-[420px_minmax(0,1fr)] lg:gap-16">
          <div className="w-full">{children}</div>

          <div className="hidden lg:block">
            <AuthAside />
          </div>
        </div>
      </main>

      <footer className="text-subtle relative z-10 px-5 py-6 text-center text-[12.5px] lg:px-10">
        {/*
          One of the two places the tagline appears — the brand sheet asks for it
          selectively, and someone signing up is meeting the brand rather than
          using it.

          Hidden at `lg`, where `AuthAside` is already saying it in 28px type.
          Twice on one screen is not emphasis, it is a component that does not
          know what its neighbour is doing.
        */}
        <p className="mb-3 lg:hidden">{BRAND.tagline}</p>
        <Link href="/terms" className="hover:text-foreground transition">
          Terms
        </Link>
        <span className="px-2">·</span>
        <Link href="/privacy" className="hover:text-foreground transition">
          Privacy
        </Link>
      </footer>
    </div>
  );
}
