import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "@/components/shell/brand";
import { BRAND } from "@/config/brand";

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
  return (
    <div className="bg-background relative flex min-h-full flex-col">
      <div className="bg-grid pointer-events-none absolute inset-x-0 top-0 h-[420px] opacity-40" />

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

      <main className="relative z-10 flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>

      <footer className="text-subtle relative z-10 px-5 py-6 text-center text-[12.5px] lg:px-10">
        {/* One of the two places the tagline appears — §7 asks for it selectively,
            and someone signing up is meeting the brand rather than using it. */}
        <p className="mb-3">{BRAND.tagline}</p>
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
