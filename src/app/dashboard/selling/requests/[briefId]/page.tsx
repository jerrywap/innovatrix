import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleHelp, EyeOff } from "lucide-react";
import { MoneyDisplay } from "@/components/money-display";
import { money, type CurrencyCode } from "@/lib/money";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { NotFoundError } from "@/lib/errors";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { vendorThread } from "@/services/messaging/messaging-service";
import { briefForVendor, threadScopeForVendor } from "@/services/vendors/brief-service";
import { objectIdSchema } from "@/validators/common";
import { BriefPanel } from "@/features/vendors/components/brief-panel";

export const metadata: Metadata = { title: "Customization request" };

// TODO: Cache Components adoption. Refactor this segment so this opt-out can be
// removed. See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/**
 * One brief, as its vendor reads it — vendor ticket 14.
 *
 * ## Everything on this page is mediated, and none of it by hiding
 *
 * There is no customer name to omit here. `briefForVendor` returns a `VendorBriefView`, which has no
 * field for a customer, an organisation or a request id — the same layer-3 discipline that gives
 * `CustomerMessage` no `visibility`. And the thread is a **different conversation** from the
 * customer's, so `vendorThread()` on this subject can only return staff and vendor messages: there is
 * no customer message in the collection to filter out.
 *
 * That is why the guarantee is worth having. A projection can be got wrong; a document that never
 * held the field, on a thread the customer was never party to, cannot leak it.
 *
 * ## Blocking, not streamed
 *
 * The 404 depends on the main query — an id belonging to another vendor must answer not-found, not
 * forbidden, or the screen becomes an oracle for which brief ids are real. There is nothing to
 * stream ahead of that decision, so there is no `<Suspense>` pretending otherwise, and no
 * `loading.tsx` at or above this segment.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/selling/requests/[briefId]">) {
  const context = await requireVendorOrForbid();

  const { briefId } = await params;
  // Before the scoped read, so a malformed id is not an error page — and so the shape of the
  // refusal does not depend on whether the id could have existed.
  if (!objectIdSchema.safeParse(briefId).success) notFound();

  /*
   * `NotFoundError` → `notFound()`. The service throws rather than returning null because every
   * other caller wants the throw; this page is the one place it becomes a status code.
   */
  const brief = await briefForVendor(briefId, { vendorId: context.vendorId }).catch((error) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  const organizationId = await threadScopeForVendor(briefId, { vendorId: context.vendorId });
  const messages = await vendorThread({
    organizationId,
    subjectType: "vendor_brief",
    subjectId: briefId,
    viewerUserId: context.user.id,
  });

  const open = brief.status === "sent";

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={brief.title}
        description={brief.productName}
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Requests", href: "/dashboard/selling/requests" },
          { label: brief.title },
        ]}
        actions={<StatusBadge status={brief.status} />}
      />

      {/* Said once, plainly, at the top. A vendor who assumes they are talking to the buyer will
          write something different from one who knows they are not. */}
      <p className="border-border text-muted-foreground flex items-start gap-2.5 rounded-xl border border-dashed p-4 text-[13px]">
        <EyeOff className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          We pass these on without saying who asked. You are talking to us, not to the customer
          — we quote them, invoice them, and pay you your share.
        </span>
      </p>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          What they want changed
        </h2>
        <ul className="border-border divide-border divide-y rounded-xl border">
          {brief.requirements.map((requirement) => (
            <li key={requirement.key} className="flex flex-col gap-1 px-4 py-3">
              <span className="text-[13.5px]">{requirement.label}</span>
              {requirement.detail && (
                <span className="text-muted-foreground text-[12.5px]">
                  {requirement.detail}
                </span>
              )}
              {/* An assumption is exactly what a vendor should push back on, so it is labelled
                  rather than blended in with what the customer actually confirmed. */}
              {requirement.origin !== "confirmed" && (
                <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                  {requirement.origin === "assumed" ? "we assumed this" : "we suggested this"}
                </span>
              )}
            </li>
          ))}
        </ul>

        {brief.desiredTimeline && (
          <p className="text-muted-foreground text-[13px]">
            They mentioned a timeline: {brief.desiredTimeline}
          </p>
        )}
      </section>

      {brief.proposal && (
        <section className="border-border flex flex-col gap-2 rounded-xl border p-5">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">What you told us</h2>
          <p className="text-[15px]">
            {/* Through `MoneyDisplay` → `lib/money.ts`. Never `toFixed`: it is a float, and it is
                wrong for a zero-exponent currency like JPY. */}
            <MoneyDisplay
              value={money(brief.proposal.amount, brief.proposal.currency as CurrencyCode)}
            />{" "}
            <span className="text-muted-foreground text-[13px]">· {brief.proposal.effort}</span>
          </p>
          {brief.proposal.caveats && (
            <p className="text-muted-foreground text-[13px] whitespace-pre-wrap">
              {brief.proposal.caveats}
            </p>
          )}
          <p className="text-subtle font-mono text-[11px]">
            Sent {formatDateTime(brief.proposal.submittedAt)}
            {brief.proposal.validUntil &&
              ` · good until ${formatDateTime(brief.proposal.validUntil)}`}
          </p>
        </section>
      )}

      {brief.declinedReason && (
        <section className="border-border flex flex-col gap-1.5 rounded-xl border p-5">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            You turned this down
          </h2>
          <p className="text-[13px] whitespace-pre-wrap">{brief.declinedReason}</p>
        </section>
      )}

      {messages.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display flex items-center gap-2 text-[15.5px] tracking-[-0.02em]">
            <CircleHelp className="text-subtle size-4" aria-hidden />
            Between you and us
          </h2>
          <ul className="divide-border divide-y text-[13px]">
            {messages.map((message) => (
              <li key={message.id} className="flex flex-col gap-1 py-2.5">
                <span className="text-subtle font-mono text-[11px]">
                  {message.senderName ?? message.senderType} ·{" "}
                  {message.at.slice(0, 16).replace("T", " ")}
                </span>
                {/* Escaped by React. Staff-written text on a vendor's screen. */}
                <span className="whitespace-pre-wrap">{message.body}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <BriefPanel briefId={brief.id} currency={brief.currency} open={open} />
    </div>
  );
}
