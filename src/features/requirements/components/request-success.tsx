import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import type { Route } from "next";
import type { RequestStatus } from "@/lib/db/enums";
import { formatDateTime } from "@/lib/dates";
import { REQUEST_STATUS_COPY } from "@/features/requests/status-copy";
import { StatusBadge } from "@/components/status-badge";
import { DiscoveryProgress } from "./discovery-progress";

/**
 * Stage D — the request exists, and this says so properly.
 *
 * ## What was here before
 *
 * `/custom-software` had nothing: the review form replaced itself with a small
 * card holding a reference and two buttons, and only after a submit in that same
 * page session. Come back later and the page offered you the form again.
 * `/customize` had a second, simpler card that was passed the literal string
 * `"your request"` as its reference, so it read **"Sent — your request"**.
 *
 * ## Why a receipt and not a toast
 *
 * The customer has just handed over a description of their business and a list of
 * things they want built, and they have no idea what happens now. §26's four
 * facts are what answers that: the reference, when it landed, what state it is
 * in, and whose move it is. A toast that fades gives them a reference they cannot
 * read twice.
 *
 * ## The status sentence is not written here
 *
 * `REQUEST_STATUS_COPY` is the same table the request page reads, so the two
 * agree by construction rather than by somebody remembering. That matters
 * immediately: the very next thing most people do is follow the link, and
 * arriving at a page that describes their request differently from the page that
 * created it reads as two systems disagreeing.
 *
 * No turnaround, no "within X days". §40 forbids inventing one and we do not have
 * one to state.
 */
export function RequestSuccess({
  reference,
  submittedAt,
  status,
}: {
  reference: string;
  /** ISO, from the server. Formatting it here would use the browser's clock. */
  submittedAt?: string;
  status: RequestStatus;
}) {
  const copy = REQUEST_STATUS_COPY[status];

  return (
    <div className="flex flex-col gap-8">
      <DiscoveryProgress stage="submitted" />

      <div className="flex max-w-[40rem] flex-col gap-4">
        <div className="flex items-center gap-2.5">
          <span className="bg-signal-soft grid size-7 place-items-center rounded-full">
            <Check className="text-signal-text size-4" strokeWidth={3} aria-hidden />
          </span>
          <h1 className="font-display text-[24px] tracking-[-0.025em]">Request received</h1>
        </div>

        <p className="text-muted-foreground text-[14.5px] leading-relaxed">
          {copy.what} {copy.next}
        </p>
      </div>

      {/*
        A definition list, because that is what it is: four labelled facts. The
        reference is monospaced and selectable — somebody is going to quote it in
        an email.
      */}
      <dl className="border-border grid gap-x-10 gap-y-4 border-y py-5 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <dt className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            Reference
          </dt>
          <dd className="font-mono text-[14px] tabular-nums select-all">{reference}</dd>
        </div>

        {submittedAt && (
          <div className="flex flex-col gap-1">
            <dt className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
              Sent
            </dt>
            {/* Absolute, and with the time: two requests on one day want an
                order, and a relative "2 hours ago" differs between the server
                and the browser and flickers at hydration. */}
            <dd className="text-[14px]">{formatDateTime(submittedAt)}</dd>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <dt className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            Status
          </dt>
          <dd>
            <StatusBadge status={status} />
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/dashboard/requests/${reference}` as Route}
          className="bg-foreground text-background flex w-fit items-center gap-2 rounded-full px-4 py-2.5 text-[13px] font-medium"
        >
          Follow this request
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
        <Link
          href="/dashboard/requests"
          className="border-border hover:bg-surface-muted w-fit rounded-full border px-4 py-2.5 text-[13px] font-medium"
        >
          All your requests
        </Link>
      </div>
    </div>
  );
}
