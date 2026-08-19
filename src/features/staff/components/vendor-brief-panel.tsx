"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Send, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { FormErrors } from "@/features/products/components/section-form";
import type { ActionResult } from "@/lib/action-result";
import {
  replyOnBriefAction,
  routeToVendorAction,
  withdrawBriefAction,
} from "@/features/vendors/brief-actions";

type Action = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

export interface BriefSummary {
  id: string;
  status: string;
  sentAt: string;
  vendorName: string;
  proposal?: { formatted: string; effort: string; caveats?: string };
  declinedReason?: string;
}

/**
 * The staff side of a vendor-directed customization — vendor ticket 14.
 *
 * ## This panel *is* the triage gate
 *
 * Nothing reaches the vendor at submission (decision W3). A staff member reads the request and
 * presses the button here, which is why junk and abuse never land in a vendor's inbox. The request
 * moves to `technical_review` — an edge that already existed and now also means "with the vendor".
 *
 * ## And it is the relay
 *
 * Mediation means the vendor is not in the customer's thread at all, so **staff are the only route
 * between them** (decision W4). Two composers on two screens: this one writes to the vendor, and the
 * customer thread further up the page writes to the customer. Keeping them apart is what stops a
 * message going the wrong way — one composer with an audience switch would put "who reads this" one
 * mis-click from being wrong, and the wrong direction here leaks a customer's identity.
 *
 * The vendor's price is shown formatted by the server, because money renders through `lib/money.ts`
 * and a client component doing the arithmetic is how a JPY figure gets a decimal point.
 */
export function VendorBriefPanel({
  requestId,
  vendorName,
  briefs,
  canRoute,
}: {
  requestId: string;
  /** Present only when the request is about a vendor's product. */
  vendorName?: string;
  briefs: readonly BriefSummary[];
  canRoute: boolean;
}) {
  const open = briefs.find((brief) => brief.status === "sent" || brief.status === "answered");

  if (!vendorName) {
    return (
      <p className="text-muted-foreground text-[13px]">
        This one is about our own software, so there is no vendor to involve.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {briefs.length > 0 && (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {briefs.map((brief) => (
            <li key={brief.id} className="flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={brief.status} />
                <span className="text-subtle font-mono text-[11px]">
                  {brief.vendorName} · {brief.sentAt}
                </span>
              </div>

              {brief.proposal && (
                <div className="text-[13px]">
                  <p>
                    <span className="font-mono">{brief.proposal.formatted}</span> ·{" "}
                    {brief.proposal.effort}
                  </p>
                  {brief.proposal.caveats && (
                    <p className="text-muted-foreground mt-1 whitespace-pre-wrap">
                      {brief.proposal.caveats}
                    </p>
                  )}
                </div>
              )}

              {brief.declinedReason && (
                <p className="text-[13px] whitespace-pre-wrap">
                  <span className="text-subtle">They declined: </span>
                  {brief.declinedReason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <>
          <ReplyForm briefId={open.id} vendorName={vendorName} />
          {canRoute && <WithdrawForm briefId={open.id} />}
        </>
      ) : (
        canRoute && <RouteForm requestId={requestId} vendorName={vendorName} />
      )}
    </div>
  );
}

function RouteForm({ requestId, vendorName }: { requestId: string; vendorName: string }) {
  const [state, submit] = useActionState(routeToVendorAction as Action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={submit} className="flex flex-col gap-3">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="requestId" value={requestId} />

      <p className="text-muted-foreground text-[13px]">
        {vendorName} wrote this software, so they are best placed to price the change. They see
        the requirements and the product — <strong>never who asked</strong>.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Anything to tell them <span className="text-subtle font-normal">— optional</span>
        </span>
        <textarea
          name="note"
          rows={2}
          maxLength={4000}
          className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
          placeholder="They're on 2.1.0 and want to stay there if possible."
        />
        {/* The one thing that must not go in this box. Said next to the box rather than in a
            paragraph above the section, where it would be read once and forgotten. */}
        <span className="text-subtle text-[12px]">
          The vendor reads this. Don&rsquo;t include the customer&rsquo;s name or contact
          details.
        </span>
      </label>

      <Submit label={`Send to ${vendorName}`} pending="Sending…" icon={Store} />
    </form>
  );
}

function WithdrawForm({ briefId }: { briefId: string }) {
  const [state, submit] = useActionState(withdrawBriefAction as Action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={submit} className="flex flex-col gap-1.5">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}
      <input type="hidden" name="briefId" value={briefId} />
      <Withdraw />
      {/* Why anyone would: the brief is a fixed record of what the vendor was shown, so a
          requirements revision makes it describe work nobody asked for any more. */}
      <p className="text-subtle text-[12px]">
        Pull it back if the customer has changed what they want — then send a fresh one.
      </p>
    </form>
  );
}

function ReplyForm({ briefId, vendorName }: { briefId: string; vendorName: string }) {
  const [state, submit] = useActionState(replyOnBriefAction as Action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={submit} className="flex flex-col gap-2">
      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <input type="hidden" name="briefId" value={briefId} />

      <label htmlFor={`brief-reply-${briefId}`} className="text-[13px] font-medium">
        Message {vendorName}
      </label>
      <textarea
        id={`brief-reply-${briefId}`}
        name="body"
        rows={3}
        required
        maxLength={5000}
        className="border-border bg-background w-full rounded-lg border px-3 py-2 text-[13px]"
      />
      <p className="text-subtle text-[12px]">
        Goes to the vendor only. The customer&rsquo;s thread is separate — anything they should
        hear, tell them there.
      </p>

      <Submit label="Send" pending="Sending…" icon={Send} />
    </form>
  );
}

function Submit({
  label,
  pending: pendingLabel,
  icon: Icon,
}: {
  label: string;
  pending: string;
  icon: typeof Send;
}) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
      ) : (
        <Icon className="size-3.5" aria-hidden />
      )}
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Withdraw() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending} className="w-fit">
      {pending ? "Withdrawing…" : "Withdraw this brief"}
    </Button>
  );
}
