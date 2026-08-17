"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dismissReviewPromptAction } from "../actions";

/**
 * "How did you get on with it?" — vendor ticket 10.
 *
 * Shown once per entitlement, **after use** (a recorded download, or a few days for a product
 * whose delivery is not a download), and dismissible for good. `shouldPrompt` in the service
 * owns those conditions; this component owns only the asking.
 *
 * ## Why the dismissal is permanent
 *
 * "Ask me later" is a mechanism for asking somebody four times, and the fourth time is the one
 * they remember. One ask, one no, and the form stays available on the page for anybody who
 * changes their mind — which is the difference between an invitation and a nag.
 *
 * A client component for one reason: revealing the form without a round trip. The dismissal is
 * a real server action, because a dismissal that only lived in React state would come back on
 * the next page load.
 */
export function ReviewPrompt({
  entitlementId,
  children,
}: {
  entitlementId: string;
  /** The form, revealed in place rather than on another screen. */
  children: React.ReactNode;
}) {
  const [state, dismiss] = useActionState(dismissReviewPromptAction, null);
  const [writing, setWriting] = useState(false);

  // Optimistically gone. The action has already succeeded, and leaving a dismissed prompt on
  // screen until a revalidation lands would read as the button not working.
  if (state?.ok) return null;

  if (writing) return <>{children}</>;

  return (
    <div className="border-border bg-surface-muted/40 flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-display flex items-center gap-2 text-[15.5px] tracking-[-0.02em]">
        <Star className="text-subtle size-4" aria-hidden />
        How did you get on with it?
      </h2>
      <p className="text-muted-foreground text-[13px]">
        Your review helps the next buyer decide, and the seller can reply to it publicly. Only
        people who have bought a product can review it.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={() => setWriting(true)} className="w-fit">
          Write a review
        </Button>

        {/* A form rather than an `onClick` fetch: it is a state change on the server, and a
            plain form is what works if the island never hydrates. */}
        <form action={dismiss}>
          <input type="hidden" name="entitlementId" value={entitlementId} />
          <Dismiss />
        </form>
      </div>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
    </div>
  );
}

function Dismiss() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      No thanks
    </Button>
  );
}
