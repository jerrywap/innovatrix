import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed, Package } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireStaffOrRedirect } from "@/lib/auth/dal";
import { loadRequest } from "@/features/requests/request-view";
import { Attachments } from "@/features/requests/components/attachments";
import { permittedTransitions } from "@/services/requests/request-service";
import { TransitionForm } from "@/features/staff/components/transition-form";
import { InterpretationForm } from "@/features/staff/components/interpretation-form";
import { Transcript } from "@/features/staff/components/transcript";
import { FollowUpForm } from "@/features/staff/components/follow-up-form";
import { Thread } from "@/features/messaging/components/thread";
import { staffThread } from "@/services/messaging/messaging-service";
import { QuotePanel } from "@/features/quotes/components/quote-panel";
import { listQuotesForRequest } from "@/features/quotes/quote-view";

export const metadata: Metadata = { title: "Request" };

/**
 * The request workspace — §30, §101.
 *
 * ## Everything in one view, because §101 says so
 *
 * *"Staff must never receive 'customer wants CRM' with nothing attached."* So
 * the base product, its version, the confirmed requirements, the assumptions,
 * the full AI transcript and the timeline are all on this page. No tabs to the
 * left of the important thing, no "view conversation" that navigates away and
 * loses the requirements.
 *
 * ## What staff may do comes from the state machine, not from this file
 *
 * `permittedTransitions` reads `REQUEST_TRANSITION_RULES` with this reader's
 * permissions, so the buttons are exactly the moves the service would allow.
 * A rendered button that the service then refuses is the failure this avoids —
 * and equally, no button appears that would work.
 *
 * ## Two things are deliberately disabled rather than missing
 *
 * Customer messaging is ticket 21 and quoting is ticket 22. Both are shown
 * where §30 puts them, greyed, saying why. An absence reads as an oversight;
 * a disabled control with a reason reads as a plan.
 */
export default async function Page({ params }: PageProps<"/staff/requests/[reference]">) {
  const { reference } = await params;
  const staff = await requireStaffOrRedirect();

  // No organisation filter: staff read across organisations (§30). The DAL
  // above is what makes that legitimate.
  const request = await loadRequest(reference, { audience: "staff" });
  if (!request) notFound();

  const actions = permittedTransitions(request.status, {
    type: "staff",
    userId: staff.user.id,
    ...(staff.user.name ? { name: staff.user.name } : {}),
    permissions: staff.permissions,
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={request.title}
        description={`${request.reference} · ${request.kind === "customization" ? "Customization" : "Custom build"}`}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {/* ── left: what the customer actually said ─────────── */}
        <div className="flex flex-col gap-6">
          {request.baseProduct && (
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
                href={`/marketplace/${request.baseProduct.slug}` as Route}
                className="border-border hover:bg-surface-muted rounded-full border px-3.5 py-1.5 text-[12.5px]"
              >
                Product page
              </Link>
            </section>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-[16px] tracking-[-0.02em]">
              Customer-confirmed requirements
            </h2>
            <p className="text-subtle text-[12px]">
              §34 — the customer owns these. Record a different reading below rather than
              editing them.
            </p>
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
                      <p className="text-muted-foreground text-[12.5px]">
                        {requirement.detail}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {request.assumptions.length > 0 && (
            <section className="flex flex-col gap-3">
              <h2 className="font-display text-[16px] tracking-[-0.02em]">
                Assumed or suggested, not confirmed
              </h2>
              <ul className="border-border divide-border divide-y rounded-xl border border-dashed">
                {request.assumptions.map((assumption) => (
                  <li key={assumption.key} className="flex items-start gap-2.5 px-4 py-2.5">
                    <CircleDashed className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
                    <div>
                      <p className="text-muted-foreground text-[13.5px]">{assumption.label}</p>
                      <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                        {assumption.origin}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Attachments
            requestId={request.id}
            reference={request.reference}
            attachments={request.attachments}
            canUpload={false}
          />

          <InterpretationForm
            requestId={request.id}
            reference={request.reference}
            initial={request.internalInterpretation ?? ""}
            canEdit={staff.permissions.has("request.comment_internal")}
          />

          {request.transcript && request.transcript.length > 0 && (
            <Transcript messages={request.transcript} />
          )}

          {request.organizationId && (
            <Thread
              subjectType="request"
              subjectId={request.id}
              reference={request.reference}
              organizationId={request.organizationId}
              messages={await staffThread({
                organizationId: request.organizationId,
                subjectType: "request",
                subjectId: request.id,
                viewerUserId: staff.user.id,
              })}
              audience="staff"
              canReplyToCustomer={staff.permissions.has("message.reply_customer")}
            />
          )}
        </div>

        {/* ── right: status, actions, timeline ──────────────── */}
        <div className="flex flex-col gap-6">
          <section className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={request.status} />
              {request.waitingOn && (
                <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  waiting on {request.waitingOn === "customer" ? "customer" : "us"}
                </span>
              )}
            </div>

            <p className="text-muted-foreground text-[12.5px]">
              Assigned to{" "}
              <strong className="text-foreground font-medium">
                {request.assigneeName ?? "nobody"}
              </strong>
            </p>

            {actions.length > 0 ? (
              <TransitionForm
                requestId={request.id}
                reference={request.reference}
                actions={actions}
              />
            ) : (
              <p className="text-subtle text-[12.5px]">
                Nothing to move from here with your permissions.
              </p>
            )}
          </section>

          {request.organizationId && (
            <FollowUpForm
              organizationId={request.organizationId}
              subjectType="request"
              subjectId={request.id}
              returnTo={`/staff/requests/${request.reference}`}
            />
          )}

          <QuotePanel
            requestReference={request.reference}
            quotes={await listQuotesForRequest(request.id)}
            canDraft={staff.permissions.has("quote.draft")}
            canIssue={staff.permissions.has("quote.issue")}
          />

          <section className="flex flex-col gap-3">
            <h2 className="font-display text-[16px] tracking-[-0.02em]">Timeline</h2>
            <ul className="border-border divide-border divide-y rounded-xl border">
              {request.timeline.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-[12.5px]">{entry.message}</span>
                    <span className="text-subtle shrink-0 font-mono text-[10.5px]">
                      {entry.at}
                    </span>
                  </span>
                  {/* The customer's timeline and ours are the same feed with a
                      different filter, so saying which is which here stops
                      staff assuming the customer saw an internal note. */}
                  <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                    {entry.internal ? "internal" : "customer sees this"}
                    {entry.actorName ? ` · ${entry.actorName}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
