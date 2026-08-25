import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { AlertTriangle, Store } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { MoneyDisplay } from "@/components/money-display";
import { StarRating } from "@/components/star-rating";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime, formatDay } from "@/lib/dates";
import { isCurrencyCode, money } from "@/lib/money";
import { requireVendorOrNull } from "@/lib/auth/dal";
import { actionItems, vendorAnalytics } from "@/services/vendors/analytics-service";

export const metadata: Metadata = { title: "Selling" };

/**
 * The vendor's home — vendor ticket 01, and the application-status screen until
 * they are verified.
 *
 * One page rather than two, because the question it answers is the same one
 * throughout ("where do I stand?") and a separate status route would be a page
 * that exists for a few days and then 404s or redirects forever.
 *
 * The guard is in this component's own body rather than inside a `<Suspense>`d
 * child, and there is deliberately no `loading.tsx` anywhere under
 * `/dashboard/selling`: once bytes are on the wire the status line is committed,
 * so a boundary above a refusing page renders the refusal under `200 OK`.
 * `loading-boundaries.test.ts` enforces both.
 */
export default async function Page() {
  const context = await requireVendorOrNull();

  if (!context) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Selling"
          description="List your own software on the CoSetup marketplace."
        />
        <EmptyState
          icon={Store}
          title="You're not a vendor yet"
          description="Apply to sell your own software here. We review every application, and you keep working as a customer in the meantime."
          action={
            <Button asChild>
              <Link href="/dashboard/selling/apply">Apply to sell</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const { vendor } = context;

  if (vendor.status !== "verified") {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <PageHeader
          title={vendor.displayName}
          description="Your application to sell on CoSetup."
          actions={<StatusBadge status={vendor.status} />}
        />

        <div className="border-border bg-surface-muted/40 flex flex-col gap-3 rounded-xl border p-5 text-[13.5px]">
          <p className="text-muted-foreground">{statusExplanation(vendor.status)}</p>

          {vendor.rejectionReason && (
            <p className="border-border border-t pt-3">
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                What we said
              </span>
              <br />
              {vendor.rejectionReason}
            </p>
          )}

          {vendor.suspensionReason && (
            <p className="border-border border-t pt-3">
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                Why
              </span>
              <br />
              {vendor.suspensionReason}
            </p>
          )}

          <p className="text-subtle border-border border-t pt-3">
            Applied {formatDateTime(vendor.appliedAt)}
          </p>
        </div>

        {/*
          The next step, not a consolation panel.

          Applying and verifying are separate internally — different decisions, made by
          different people, at different times — and presenting them as two separate errands
          left the applicant with a screen whose only message was "wait". They are one flow
          from where the vendor is standing, so this is a primary action and it says what it
          unlocks rather than what it is called.
        */}
        {(vendor.status === "applied" || vendor.status === "in_review") && (
          <div className="border-border bg-surface-muted/30 flex flex-col gap-3 rounded-xl border p-5">
            <div className="flex flex-col gap-1">
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                Next step
              </span>
              <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
                Verify your identity
              </h2>
            </div>
            <p className="text-muted-foreground text-[13px] leading-relaxed">
              A government ID and proof of your address. It usually takes a few minutes to send
              and it is what unlocks listing a product — so getting it in now means nothing is
              left to do when your application is approved.
            </p>
            <Button asChild className="mt-1 w-fit">
              <Link href="/dashboard/selling/verification">Start identity verification</Link>
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={vendor.displayName}
        description="Your vendor account."
        actions={<StatusBadge status={vendor.status} />}
      />

      {/*
        Vendor ticket 12, §102: **what needs doing, before any figure.**

        A vendor who came to check on things reads the numbers; a vendor who came because
        something is waiting on them does not know it yet, and that is the far more common
        case. Suspended above everything else — a vendor whose products are unlisted needs to
        know that before they read a sales figure.
      */}
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-xl" />}>
        <WhatNeedsDoing vendorId={context.vendorId} />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Performance vendorId={context.vendorId} />
      </Suspense>

      {/* The storefront, once there is one — vendor ticket 11. */}
      <div className="border-border rounded-xl border p-5">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Your storefront</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Customers see this when they follow your name from a product. It goes live once you
          are verified and have something published.
        </p>
        {/*
          The preview, not `/vendors/${vendor.slug}` — which this button linked to until a vendor
          with one draft followed it into a 404 and read that as their storefront being broken.
          The preview renders in every state and links onward to the live page once there is one.
        */}
        <Button asChild variant="outline" className="mt-3.5">
          <Link href="/dashboard/selling/storefront">View your storefront</Link>
        </Button>
      </div>

      <div className="border-border rounded-xl border p-5">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Verification</h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Identity lets you list. Business verification is what lets a payout run — you can sell
          before it completes, and earnings simply are not payable yet.
        </p>
        <dl className="mt-4 flex flex-wrap gap-6">
          <div>
            <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
              Identity
            </dt>
            <dd className="mt-1.5">
              <StatusBadge status={vendor.verification.identity.status} />
            </dd>
          </div>
          <div>
            <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
              Business
            </dt>
            <dd className="mt-1.5">
              <StatusBadge status={vendor.verification.business.status} />
            </dd>
          </div>
        </dl>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/dashboard/selling/verification">Manage documents</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * What each pre-verified state means, in the second person.
 *
 * Not derived from the status label: "In review" is the badge, and a person
 * looking at this screen wants to know whether it is their move.
 */
function statusExplanation(status: string): string {
  switch (status) {
    case "applied":
      return "Vendor application started.";
    case "in_review":
      return "Somebody is reading your application now. Carry on with verification while they do — the two run side by side, and if we need anything else we'll ask by email.";
    case "rejected":
      return "We are not able to take this application forward.";
    case "suspended":
      return "Your account is suspended, so new sales are paused. Customers who already bought from you keep their software and their downloads.";
    case "offboarded":
      return "This vendor account is closed. Customers who bought from you keep everything they bought.";
    default:
      return "";
  }
}

/**
 * The action list — §102's "lead with what needs doing".
 *
 * Renders nothing at all when there is nothing to do. An empty "0 items need attention" panel is
 * a permanent fixture that trains a vendor to skip the top of the page, which is exactly where
 * the important thing appears on the day there is one.
 */
async function WhatNeedsDoing({ vendorId }: { vendorId: string }) {
  const items = await actionItems({ vendorId });
  if (items.length === 0) return null;

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.kind}>
          <Link
            href={item.href as Route}
            className="border-border hover:bg-surface-muted flex items-start gap-2.5 rounded-xl border p-4 text-[13.5px] transition"
          >
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
              aria-hidden
            />
            <span>{item.message}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The figures — vendor ticket 12.
 *
 * Everything here is derived from the ledger, the reviews or the download log; there is no
 * stored counter anywhere that could drift from what it counts (§103).
 *
 * **Traffic is absent, and the screen says why.** Nothing in the platform counts a page view,
 * and the ticket is explicit that a plausible-looking placeholder is worse than an honest gap:
 * a vendor who makes a pricing decision on a fabricated conversion rate has been misled by us.
 */
async function Performance({ vendorId }: { vendorId: string }) {
  const analytics = await vendorAnalytics({ vendorId });

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            Sales, last {analytics.windowDays} days
          </h2>
          <span className="text-subtle font-mono text-[11px]">
            since {formatDay(analytics.from)}
          </span>
        </div>

        {analytics.products.length === 0 ? (
          <p className="text-muted-foreground text-[13px]">
            No sales in this period. Figures appear here as soon as somebody buys.
          </p>
        ) : (
          <ul className="border-border divide-border divide-y rounded-xl border text-[13px]">
            {analytics.products.map((row) => (
              <li key={row.productId} className="flex flex-col gap-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    {row.name}
                    {row.listingSuppressed && (
                      <span className="text-subtle font-mono text-[10px] tracking-[0.14em] uppercase">
                        unlisted
                      </span>
                    )}
                  </span>
                  <span className="flex flex-wrap items-center gap-3">
                    {row.rating && (
                      <StarRating
                        average={row.rating.average}
                        count={row.rating.count}
                        size="small"
                      />
                    )}
                    <span className="text-subtle font-mono text-[11px]">
                      {row.units} {row.units === 1 ? "sale" : "sales"}
                    </span>
                    {row.earnings
                      .filter((e) => isCurrencyCode(e.currency))
                      .map((earning) => (
                        <MoneyDisplay
                          key={earning.currency}
                          value={money(earning.amount, earning.currency as never)}
                        />
                      ))}
                  </span>
                </div>
                {row.refunded.length > 0 && (
                  <span className="text-[12px] text-[var(--danger)]">
                    {row.refunded
                      .map((refund) => `${refund.currency} ${(refund.amount / 100).toFixed(2)}`)
                      .join(", ")}{" "}
                    refunded
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {analytics.downloads.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            Downloads by version
          </h2>
          <p className="text-muted-foreground text-[13px]">
            How an update is being taken up. A new version with few downloads usually means
            customers have not been told, rather than that they do not want it.
          </p>
          <ul className="border-border divide-border divide-y rounded-xl border text-[13px]">
            {analytics.downloads.map((row) => (
              <li
                key={row.versionId}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span>
                  {row.productName} <span className="text-subtle">v{row.version}</span>
                </span>
                <span className="text-subtle font-mono text-[11px] tabular-nums">
                  {row.count}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/*
        The honest gap. Named rather than filled: nothing in the platform counts a page view, and
        a made-up conversion rate is a number a vendor would price against.
      */}
      <p className="text-subtle border-border rounded-xl border border-dashed p-4 text-[12.5px]">
        We do not yet report how many people viewed your products or your storefront. When we
        do, it will be a real count rather than an estimate — so for now there is nothing here
        rather than a number you could not rely on.
      </p>
    </div>
  );
}
