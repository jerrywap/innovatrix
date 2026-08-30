import Link from "next/link";
import type { Route } from "next";
import { CATALOGUE_SURFACE } from "@/config/catalogue";
import { getTaxonomyIndex } from "@/services/marketplace";

/**
 * The industries strip.
 *
 * ## Real terms, not a written list
 *
 * This was ten hardcoded words. They are now the actual industry vocabulary, so
 * the strip cannot advertise a sector the catalogue has nothing in — and each one
 * is a **link** into its own landing page, which turns a decorative band into
 * discovery. `/marketplace/industry/<slug>` is a real route.
 *
 * ## The marquee, and why it is duplicated
 *
 * `animate-marquee` translates `-50%`, so the list is rendered twice: the second
 * copy is what the eye is looking at as the first scrolls out, and without it the
 * band would visibly empty and snap back.
 *
 * `motion-reduce:animate-none` is not decoration — a permanently moving band is
 * exactly what `prefers-reduced-motion` is for. Stopped, it reads as a static row
 * of links, which is the fallback we want anyway.
 */
export async function Industries() {
  const taxonomy = await getTaxonomyIndex("script");
  const industries = taxonomy.industry.slice(0, 14);

  // Nothing seeded yet: a band containing one chip looks broken, so it goes.
  if (industries.length < 4) return null;

  return (
    <section className="border-border bg-surface-muted/40 overflow-hidden border-y py-5">
      <h2 className="sr-only">Industries we have software for</h2>
      <div className="animate-marquee flex w-max gap-3 motion-reduce:animate-none">
        {[0, 1].map((copy) => (
          <ul
            key={copy}
            className="flex shrink-0 gap-3"
            {...(copy === 1 ? { "aria-hidden": true } : {})}
          >
            {industries.map((term) => (
              <li key={term.slug}>
                <Link
                  href={`${CATALOGUE_SURFACE.script.industryPath}/${term.slug}` as Route}
                  className="border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground block rounded-full border px-4 py-2 text-[13px] whitespace-nowrap transition"
                  {...(copy === 1 ? { tabIndex: -1 } : {})}
                >
                  {term.name}
                </Link>
              </li>
            ))}
          </ul>
        ))}
      </div>
    </section>
  );
}
