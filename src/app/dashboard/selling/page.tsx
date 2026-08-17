import type { Metadata } from "next";
import Link from "next/link";
import { Store } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { requireVendorOrNull } from "@/lib/auth/dal";

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
          description="List your own software on the Innovatrix marketplace."
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
          description="Your application to sell on Innovatrix."
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

        {(vendor.status === "applied" || vendor.status === "in_review") && (
          <div className="border-border rounded-xl border p-5">
            <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
              Get ahead while you wait
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              Identity verification is what lets you list a product. You can upload your
              documents now rather than after a decision.
            </p>
            <Button asChild variant="outline" className="mt-3.5">
              <Link href="/dashboard/selling/verification">Start verification</Link>
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
        Products, earnings and the storefront link belong here — vendor tickets 04,
        08 and 11. `typedRoutes` will not compile a link to a route that has not
        been built, which is the rule working: each panel arrives with the screen
        it points at, rather than a dead link landing first.
      */}
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
      return "We have your application and nobody has picked it up yet. There is nothing for you to do — we will email the address on your application either way.";
    case "in_review":
      return "Somebody is reading your application now. If we need anything else we will ask by email.";
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
