"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { recordRecommendationChoiceAction } from "../actions";

/**
 * §24 — "we may already have this".
 *
 * ## Both options are equally available, and that is the requirement
 *
 * §24 says *"Never force the marketplace option"* and that continuing with a
 * custom build must never be buried. So the two buttons are the same size and
 * the same prominence, dismissing costs one click, and nothing re-prompts
 * afterwards.
 *
 * It would be easy to make this a nag — the marketplace sale is cheaper for us.
 * That is exactly why the spec forbids it, and why the honest version says what
 * each product *doesn't* cover as well as what it does.
 *
 * ## What was shown, and what they chose, is recorded
 *
 * A valuable business signal: it says which custom requests we could already
 * have served, which is how the catalogue learns what to build next.
 */
export function Recommendations({
  conversationId,
  products,
}: {
  conversationId: string;
  products: { slug: string; name: string; summary?: string }[];
}) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || products.length === 0) return null;

  return (
    <section className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex items-start gap-2.5">
        <Store className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
        <div>
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            We may already have {products.length === 1 ? "something" : "a couple of things"}{" "}
            close to this
          </h2>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Worth a look before we build from scratch — buying one and adapting it is usually
            faster. Nothing you&rsquo;ve told us is lost either way.
          </p>
        </div>
      </div>

      <ul className="flex flex-col gap-2">
        {products.map((product) => (
          <li
            key={product.slug}
            className="border-border bg-background flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5"
          >
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">{product.name}</p>
              {product.summary && (
                <p className="text-muted-foreground truncate text-[12.5px]">
                  {product.summary}
                </p>
              )}
            </div>
            <Link
              href={`/customize/${product.slug}` as Route}
              onClick={() =>
                void recordRecommendationChoiceAction({
                  conversationId,
                  choice: "existing_product",
                  shownSlugs: products.map((candidate) => candidate.slug),
                })
              }
              className="border-border hover:bg-surface-muted shrink-0 rounded-full border px-3.5 py-1.5 text-[12.5px]"
            >
              Look at this one
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setDismissed(true);
            void recordRecommendationChoiceAction({
              conversationId,
              choice: "custom_build",
              shownSlugs: products.map((candidate) => candidate.slug),
            });
          }}
          className="w-fit"
        >
          Continue with a custom build
        </Button>
        <span className="text-subtle text-[12px]">We won&rsquo;t ask again.</span>
      </div>
    </section>
  );
}
