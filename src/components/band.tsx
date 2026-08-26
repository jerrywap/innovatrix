import Link from "next/link";
import type { Route } from "next";
import { cn } from "@/lib/utils";

/**
 * The homepage's section rhythm, in one place.
 *
 * The page previously repeated the eyebrow's class string four different ways
 * (`text-[10px]`/`[10.5px]`/`[9.5px]`, `tracking-[0.2em]`/`[0.14em]`/`[0.16em]`)
 * and its band wrapper three. With nine bands instead of seven that becomes the
 * dominant source of drift, so the wrapper and the heading are components and the
 * variation that remains is a prop.
 *
 * `tone` is the only visual decision a band makes:
 *
 * - `plain` — the page ground.
 * - `muted` — `bg-surface-muted/40` between borders. The existing banded idiom.
 * - `inverse` — the dark slab, for the one band that has to interrupt the scroll.
 *
 * Alternating them is what the brief means by "stronger contrast between
 * sections while keeping one coherent system": the contrast comes from the ground
 * a band sits on, not from each band inventing its own palette.
 */
export function Band({
  id,
  tone = "plain",
  className,
  children,
}: {
  id?: string;
  tone?: "plain" | "muted" | "inverse";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      {...(id ? { id } : {})}
      className={cn(
        tone === "muted" && "border-border bg-surface-muted/40 border-y",
        tone === "inverse" && "bg-surface-inverse text-foreground-inverse grain relative",
        className,
      )}
    >
      <div className="mx-auto max-w-[1400px] px-5 py-20 lg:px-10 lg:py-28">{children}</div>
    </section>
  );
}

/** The mono uppercase kicker above a section heading. */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">{children}</p>
  );
}

/**
 * A band's heading block, optionally with a "see all" on the right.
 *
 * `href`/`linkLabel` travel together — a heading with a destination and no words
 * for it, or words with nowhere to go, are both bugs rather than configurations,
 * so the type makes them one optional pair.
 */
export function SectionHead({
  eyebrow,
  title,
  lede,
  action,
  inverse,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lede?: React.ReactNode;
  action?: { href: Route; label: string };
  inverse?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="mt-3.5 max-w-[24ch] text-[clamp(1.75rem,4.2vw,3rem)] leading-[1.02] font-semibold tracking-[-0.04em] text-balance">
          {title}
        </h2>
        {lede && (
          <p
            className={cn(
              "mt-4 max-w-[52ch] text-[15.5px] leading-relaxed",
              inverse ? "opacity-75" : "text-muted-foreground",
            )}
          >
            {lede}
          </p>
        )}
      </div>

      {action && (
        <Link
          href={action.href}
          className={cn(
            "shrink-0 rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition",
            inverse
              ? "hover:bg-foreground-inverse/10 border-current/25"
              : "border-border bg-surface hover:border-border-strong",
          )}
        >
          {action.label} <span aria-hidden>→</span>
        </Link>
      )}
    </div>
  );
}
