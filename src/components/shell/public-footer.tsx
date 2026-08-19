import Link from "next/link";
import type { Route } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import { Brand } from "./brand";

/**
 * Marketing footer.
 *
 * Every link here resolves. The version this replaced used `href="#"` for
 * fifteen of them — which looks complete and is a promise the product doesn't
 * keep. With `typedRoutes` on, a href to something unbuilt no longer compiles,
 * so the columns below list what exists and nothing else.
 */

const COLUMNS: ReadonlyArray<{
  heading: string;
  links: ReadonlyArray<{ label: string; href: Route }>;
}> = [
  {
    heading: "Platform",
    links: [
      { label: "Marketplace", href: "/marketplace" },
      { label: "Custom build", href: "/custom-software" },
      { label: "Services", href: "/services" },
      { label: "Pricing", href: "/pricing" },
    ],
  },
  {
    /*
     * Vendor tickets 01 and 11 — the front door.
     *
     * `/sell` existed for six tickets and was linked from **nowhere**: not here, not in
     * `PUBLIC_NAV`, not on the homepage, not in the sitemap. The application form behind it
     * worked perfectly and no visitor could reach it, which is the same as not having built it.
     */
    heading: "Sell with us",
    links: [
      { label: "Sell your software", href: "/sell" },
      { label: "Vendor agreement", href: "/terms/vendor" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { label: "Terms", href: "/terms" },
      { label: "Privacy", href: "/privacy" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-border border-t">
      <div className="mx-auto max-w-[1400px] px-5 py-14 lg:px-10">
        <div className="border-border grid gap-10 border-b pb-11 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <Brand />
            <p className="text-muted-foreground mt-4 max-w-[34ch] text-[13.5px] leading-relaxed">
              Find, customise, build, deploy and maintain software — in one place.
            </p>
            <ThemeToggle className="mt-6 sm:hidden" />
          </div>

          {COLUMNS.map((column) => (
            <div key={column.heading}>
              <div className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                {column.heading}
              </div>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-muted-foreground hover:text-foreground text-[13.5px] transition"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/*
          `/concepts` used to be linked here, on every public page. It is an
          internal design gallery — `noindex`, five alternative versions of the
          product, and its own footnotes say the numbers in it are illustrative.
          A customer following it from the footer found invented statistics
          presented as ours. The route stays; the invitation does not.
        */}
        <div className="text-subtle flex flex-col gap-3 pt-6 font-mono text-[10px] tracking-[0.14em] uppercase sm:flex-row sm:justify-between">
          <span>© 2026 Innovatrix Ltd</span>
        </div>
      </div>
    </footer>
  );
}
