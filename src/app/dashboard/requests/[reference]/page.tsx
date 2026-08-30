import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed, Package } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireOrg } from "@/lib/auth/dal";
import { loadRequest } from "@/features/requests/request-view";
import { Attachments } from "@/features/requests/components/attachments";
import { Thread } from "@/features/messaging/components/thread";
import { customerThread } from "@/services/messaging/messaging-service";
import { Timeline } from "@/components/timeline";
import { productHref } from "@/config/catalogue";

export const metadata: Metadata = { title: "Request" };

/**
 * One request, from the customer's side — §70, §101.
 *
 * ## The status says what happens next, not just what it is
 *
 * "technical_review" tells a customer nothing. `statusExplanation` carries two
 * sentences: what is happening, and whose move it is. A customer who cannot
 * tell whether they are waiting on us or we are waiting on them will email to
 * ask, which is a support ticket the copy could have prevented.
 *
 * ## Nothing internal is loaded, not merely hidden
 *
 * `loadRequest(..., { audience: "customer" })` filters the timeline to
 * `visibility: "customer"` and returns an object with **no**
 * `internalInterpretation` key. There is nothing on this page to leak, which
 * is a stronger property than remembering not to render it.
 */
export default async function Page({ params }: PageProps<"/dashboard/requests/[reference]">) {
  const { reference } = await params;
  const { organizationId, user } = await requireOrg();

  const request = await loadRequest(reference, { audience: "customer", organizationId });
  if (!request) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={request.title} description={request.reference} />

      <section className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <StatusBadge status={request.status} />
          {request.waitingOn === "customer" && (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-amber-700 uppercase dark:text-amber-400">
              needs you
            </span>
          )}
        </div>
        <p className="text-[14px]">{request.statusExplanation.what}</p>
        <p className="text-muted-foreground text-[13px]">{request.statusExplanation.next}</p>
      </section>

      {request.baseProduct && (
        // §20/§101 — a customisation is always a customisation *of something*,
        // and the link keeps that one click away on both sides.
        <section className="border-border bg-surface flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <span className="flex items-center gap-2.5 text-[13.5px]">
            <Package className="text-subtle size-4" aria-hidden />
            Based on <strong className="font-medium">{request.baseProduct.name}</strong>
            {request.baseProduct.version && (
              <span className="text-subtle font-mono text-[11.5px]">
                v{request.baseProduct.version}
              </span>
            )}
          </span>
          <Link
            href={productHref(request.baseProduct.slug) as Route}
            className="border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[12.5px]"
          >
            See the product
          </Link>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">What you asked for</h2>
        <ul className="border-border divide-border divide-y rounded-xl border">
          {request.customerRequirements.map((requirement) => (
            <li key={requirement.key} className="flex items-start gap-2.5 px-4 py-2.5">
              <CircleCheck
                className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                aria-hidden
              />
              <div>
                <p className="text-[13.5px]">{requirement.label}</p>
                {requirement.detail && (
                  <p className="text-muted-foreground text-[12.5px]">{requirement.detail}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {request.assumptions.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-display text-[17px] tracking-[-0.02em]">
              Things we weren&rsquo;t sure about
            </h2>
            <p className="text-muted-foreground mt-1 text-[13px]">
              We noted these but you didn&rsquo;t confirm them, so they&rsquo;re not part of the
              request. Tell us if any should be.
            </p>
          </div>
          <ul className="border-border divide-border divide-y rounded-xl border border-dashed">
            {request.assumptions.map((assumption) => (
              <li key={assumption.key} className="flex items-start gap-2.5 px-4 py-2.5">
                <CircleDashed className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
                <div>
                  <p className="text-muted-foreground text-[13.5px]">{assumption.label}</p>
                  {assumption.detail && (
                    <p className="text-subtle text-[12.5px]">{assumption.detail}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {request.customerNotes && (
        /*
          Their own words, and until this ticket they were thrown away.

          "Anything else" had a textarea, a `maxLength` and a Zod rule, and then
          `submitRequirementsAction` never passed it to the service — so every
          sentence anyone wrote there was validated and dropped. Shown here
          because it is the one part of the request in their voice rather than
          ours, which is exactly the part worth being able to point at.
        */
        <section className="flex flex-col gap-2">
          <h2 className="font-display text-[17px] tracking-[-0.02em]">What else you told us</h2>
          <p className="border-border bg-surface rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed whitespace-pre-wrap">
            {request.customerNotes}
          </p>
        </section>
      )}

      <Attachments
        requestId={request.id}
        reference={request.reference}
        attachments={request.attachments}
        canUpload
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">What&rsquo;s happened</h2>
        {/*
          The shared `<Timeline>` rather than a hand-rolled list. It was written
          in ticket 04, renders hour and minute, and wraps each entry in
          `<time dateTime>` — and was imported by nothing, while both request
          pages rolled their own and showed a bare day. §70's example is three
          events on one afternoon; as days they were three identical labels.
        */}
        <Timeline
          className="border-border bg-surface rounded-xl border p-5"
          entries={request.timeline.map((entry) => ({
            id: entry.id,
            title: entry.message,
            at: new Date(entry.at),
            ...(entry.actorName ? { actor: entry.actorName } : {}),
          }))}
        />
      </section>

      <Thread
        subjectType="request"
        subjectId={request.id}
        reference={request.reference}
        messages={await customerThread({
          organizationId,
          subjectType: "request",
          subjectId: request.id,
          viewerUserId: user.id,
        })}
        audience="customer"
      />
    </div>
  );
}
