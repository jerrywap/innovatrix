import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Inbox } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { formatDateTime } from "@/lib/dates";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { productHref } from "@/config/catalogue";
import { listPendingOffers } from "@/services/catalog/complete-on-request-service";
import { OfferDecision } from "@/features/products/components/offer-decision";

export const metadata: Metadata = { title: "Complete on request" };

/**
 * Vendors offering to build the application behind a template — COS-43.
 *
 * ## What is being decided here
 *
 * Whether this vendor can deliver a backend. **Not** the listing, which is already
 * published and is unchanged whichever way this goes — so the page shows what they
 * say they would build and how long they say it takes, and links to the template
 * for the rest.
 *
 * ## Oldest first
 *
 * The same decision `/staff/vendor-submissions` made, for the same reason: a vendor
 * waiting is one whose offer earns nothing, and any cleverer order is a way of
 * letting somebody wait indefinitely because their offer is inconvenient.
 *
 * **No `loading.tsx`.** This page refuses, and a boundary above a refusing route
 * flushes the shell first — committing `200 OK` before the refusal is decided.
 */
export default async function Page() {
  await requirePermissionOrForbid("product.review");

  const rows = await listPendingOffers();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Complete on request"
        description="Template vendors offering to build the working application, oldest first."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Nothing waiting"
          description="Every offer has been decided."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {rows.map((row) => (
            <article
              key={row.id}
              className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={productHref(row.slug, "template") as Route}
                    className="text-[15px] font-medium hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="text-muted-foreground mt-0.5 text-[13px]">
                    {row.vendorName}
                    {row.requestedAt && ` · asked ${formatDateTime(row.requestedAt)}`}
                  </p>
                </div>
                <Link
                  href={`/admin/products/${row.id}/options` as Route}
                  className="text-subtle text-[12.5px] underline underline-offset-4"
                >
                  Open the listing
                </Link>
              </div>

              <dl className="border-border grid gap-x-6 gap-y-2 border-t pt-3.5 sm:grid-cols-[160px_1fr]">
                <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  What they would build
                </dt>
                {/* The vendor's own words, and the whole basis of the decision —
                    `whitespace-pre-wrap` so their line breaks survive without
                    interpreting anything else. */}
                <dd className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
                  {row.scope}
                </dd>

                <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  How long
                </dt>
                <dd className="text-[13.5px]">
                  {row.leadTime ?? <span className="text-subtle">Not stated</span>}
                </dd>
              </dl>

              <div className="border-border border-t pt-4">
                <OfferDecision productId={row.id} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
