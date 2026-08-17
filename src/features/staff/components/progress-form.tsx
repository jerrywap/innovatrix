"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Megaphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { postProgressUpdateAction } from "../actions";

/**
 * Tell the customer what is happening.
 *
 * ## Why the customer-visible field is the big one
 *
 * The internal note is optional and secondary, and it looks it. That is the
 * whole intent: the failure this fixes was a customer hearing nothing for weeks
 * while the work was discussed internally. A form that made the internal note
 * the easy one would reproduce it.
 *
 * ## Two audiences, said plainly on the labels
 *
 * §37 again. Staff must be able to see at a glance which box the customer reads
 * — not infer it from placement — because the cost of guessing wrong is showing
 * somebody the deliberation about their own request.
 */
export function ProgressForm({
  requestId,
  reference,
  canPost,
}: {
  requestId: string;
  reference: string;
  /** False ⇒ shown disabled with the reason, rather than absent. */
  canPost: boolean;
}) {
  const [state, formAction] = useActionState(postProgressUpdateAction, null);

  // No manual reset: React 19 clears an uncontrolled form after its action
  // resolves. The version of this that kept a ref and called `form.reset()`
  // during render was reading a ref while rendering, which the lint rule
  // rejects and which would fight React's own reset.

  return (
    <section className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4">
      <div>
        <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
          <Megaphone className="text-subtle size-4" aria-hidden />
          Post an update
        </h2>
        <p className="text-muted-foreground mt-1 text-[13px]">
          Goes straight onto the customer&rsquo;s timeline and notifies them. Use it as the work
          moves — the status only changes at the big moments.
        </p>
      </div>

      {canPost ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="reference" value={reference} />

          <label className="flex flex-col gap-1.5">
            <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
              The customer sees this
            </span>
            <textarea
              name="message"
              required
              rows={3}
              maxLength={2000}
              placeholder="Tenant portal is done and on the test site. Reporting is next."
              className="border-border bg-background focus:ring-ring rounded-lg border px-3 py-2 text-[13.5px] outline-none focus:ring-2"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
              Internal note — optional, never shown to them
            </span>
            <textarea
              name="internalNote"
              rows={2}
              maxLength={2000}
              placeholder="Waiting on their DNS change before we can point the domain."
              className="border-border bg-surface-muted focus:ring-ring rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2"
            />
          </label>

          <div className="flex items-center gap-3">
            <Post />
            {state && !state.ok && (
              <span role="alert" className="text-[12.5px] text-[var(--danger)]">
                {state.error}
              </span>
            )}
            {state?.ok && (
              <span role="status" className="text-subtle text-[12.5px]">
                Posted — they&rsquo;ve been notified.
              </span>
            )}
          </div>
        </form>
      ) : (
        <p className="text-subtle text-[12.5px]">
          You don&rsquo;t have permission to post updates on this request.
        </p>
      )}
    </section>
  );
}

function Post() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending ? "Posting…" : "Post update"}
    </Button>
  );
}
