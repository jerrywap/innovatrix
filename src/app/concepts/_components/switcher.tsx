"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export const CONCEPTS = [
  { slug: "dialogue", n: "02", name: "Dialogue", line: "Start with a sentence" },
  { slug: "catalogue", n: "03", name: "Catalogue", line: "Curated marketplace" },
  { slug: "blueprint", n: "04", name: "Blueprint", line: "Engineered delivery" },
  { slug: "atelier", n: "05", name: "Atelier", line: "Software, commissioned" },
] as const;

export function ConceptSwitcher() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const active = CONCEPTS.find((c) => pathname?.includes(c.slug));

  if (pathname === "/concepts") return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 print:hidden">
      <div className="rounded-full border border-white/15 bg-black/80 shadow-2xl shadow-black/40 backdrop-blur-xl">
        {/* Collapsed pill */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2.5 px-4 py-2.5 text-[11px] font-medium tracking-wide text-white sm:hidden"
        >
          <span className="font-mono text-white/40">{active?.n}</span>
          {active?.name}
          <span className="text-white/40">{open ? "▾" : "▴"}</span>
        </button>

        {/* Desktop: always-visible rail */}
        <nav className="hidden items-center gap-1 p-1.5 sm:flex">
          <Link
            href="/concepts"
            className="rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide text-white/50 transition hover:text-white"
          >
            ← All
          </Link>
          {CONCEPTS.map((c) => {
            const isActive = pathname?.includes(c.slug);
            return (
              <Link
                key={c.slug}
                href={`/concepts/${c.slug}`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium tracking-wide transition ${
                  isActive
                    ? "bg-white text-black"
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="mr-1.5 font-mono opacity-50">{c.n}</span>
                {c.name}
              </Link>
            );
          })}
        </nav>

        {/* Mobile: expanded list */}
        {open && (
          <nav className="flex flex-col gap-0.5 border-t border-white/10 p-1.5 sm:hidden">
            <Link
              href="/concepts"
              className="rounded-full px-3 py-2 text-[11px] font-medium text-white/50"
            >
              ← All concepts
            </Link>
            {CONCEPTS.map((c) => (
              <Link
                key={c.slug}
                href={`/concepts/${c.slug}`}
                onClick={() => setOpen(false)}
                className={`rounded-full px-3 py-2 text-[11px] font-medium ${
                  pathname?.includes(c.slug) ? "bg-white text-black" : "text-white/70"
                }`}
              >
                <span className="mr-1.5 font-mono opacity-50">{c.n}</span>
                {c.name}
                <span className="ml-2 opacity-40">{c.line}</span>
              </Link>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}
