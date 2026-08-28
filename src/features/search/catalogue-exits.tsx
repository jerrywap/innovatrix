import "server-only";
import Link from "next/link";
import type { Route } from "next";
import { LayoutTemplate, Package } from "lucide-react";
import { CATALOGUE_SURFACE } from "@/config/catalogue";
import { marketplaceHref } from "@/services/marketplace/query";

/**
 * The two shelves, as doors out of a mixed result set.
 *
 * `/search` deliberately ranks both catalogues in one list — a template that
 * answers the question better than any script should outrank it. These are the
 * way to say "actually, I only want one of the two", which the rail cannot offer
 * because catalogue is a *surface*, not a filter (see `query.ts`'s
 * `parseMarketplaceQuery`, which reads it from options and ignores `?catalogue=`
 * in the URL).
 *
 * ## They carry the query, and only the query
 *
 * `{}` as the current params rather than `raw`, and that is not laziness.
 * `/search`'s rail can hold **template-scoped category slugs**, so carrying
 * `category=admin-dashboards` into `/marketplace` would produce a zero-result
 * page wearing a filter the visitor never chose there. The query is the one
 * thing that means the same on both shelves.
 *
 * Without a `q` they degrade to the bare listing paths, which is what the
 * landing page wants.
 *
 * `basePath` stays a literal at both call sites — the `marketplace/page.tsx`
 * convention: the *label* comes from `CATALOGUE_SURFACE`, the *route* does not,
 * because `listingPath` is a plain `string` and a cast is less safe than a
 * literal.
 */
export function CatalogueExits({
  q,
  variant = "row",
}: {
  q?: string;
  /** `row` sits above a result grid; `cards` is the landing page's two doors. */
  variant?: "row" | "cards";
}) {
  const doors = [
    {
      icon: Package,
      label: CATALOGUE_SURFACE.script.plural,
      blurb: "Whole applications you can buy, adapt and install.",
      href: marketplaceHref("/marketplace", {}, q ? { q } : {}),
    },
    {
      icon: LayoutTemplate,
      label: CATALOGUE_SURFACE.template.plural,
      blurb: "Front-ends you can drop in and make your own.",
      href: marketplaceHref("/templates", {}, q ? { q } : {}),
    },
  ];

  if (variant === "cards") {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        {doors.map(({ icon: Icon, label, blurb, href }) => (
          <Link
            key={label}
            href={href as Route}
            className="border-border bg-surface hover:border-signal/40 focus-visible:ring-ring group flex flex-col gap-2 rounded-xl border p-5 transition-colors focus-visible:ring-2 focus-visible:outline-none"
          >
            <span className="text-subtle flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] uppercase">
              <Icon className="size-3.5" aria-hidden />
              Browse
            </span>
            <span className="font-display text-[17px] tracking-[-0.02em]">{label}</span>
            <span className="text-muted-foreground text-[13.5px]">{blurb}</span>
          </Link>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-subtle text-[12.5px]">Narrow to one shelf:</span>
      {doors.map(({ icon: Icon, label, href }) => (
        <Link
          key={label}
          href={href as Route}
          className="border-border hover:bg-surface-muted flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] transition-colors"
        >
          <Icon className="text-subtle size-3.5" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}
