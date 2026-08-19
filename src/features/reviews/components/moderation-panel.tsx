"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReviewStatus } from "@/lib/db/enums";
import { moderateReviewAction } from "../actions";

/**
 * Hide, remove, restore — vendor ticket 10.
 *
 * ## Three verbs, and the difference between them is the model
 *
 * **Hide** is reversible and the author is told why. **Remove** is a policy breach. **Restore**
 * exists so hiding is not a one-way door — a moderator who fears they cannot undo it hesitates,
 * and hesitation is how a brigaded review stays up for a week.
 *
 * There is no **edit**. Staff changing a customer's words would publish an opinion attributed to
 * somebody who did not express it, and there is no action, permission or field that allows it.
 *
 * The reason is required for hide and remove, and the author reads it verbatim. "Removed for
 * breaching our guidelines" tells them nothing they can act on; the service refuses an empty
 * one rather than leaving it to this form.
 */
export function ModerationPanel({
  reviewId,
  status,
}: {
  reviewId: string;
  status: ReviewStatus;
}) {
  return (
    <div className="flex flex-col gap-3">
      {status === "published" && (
        <>
          <Decision
            reviewId={reviewId}
            to="hidden"
            label="Hide it"
            icon={<EyeOff className="size-3.5" aria-hidden />}
            note="Comes off the product page and out of the rating immediately. The author is told, in your words."
            placeholder="This names an individual member of our support team."
          />
          <Decision
            reviewId={reviewId}
            to="removed"
            label="Remove it"
            icon={<Trash2 className="size-3.5" aria-hidden />}
            note="For a policy breach. The row is kept — a review nobody can find is still evidence in a dispute about what was said."
            placeholder="Abusive language, after a warning."
            destructive
          />
        </>
      )}

      {status !== "published" && (
        <Decision
          reviewId={reviewId}
          to="published"
          label="Put it back"
          icon={<Eye className="size-3.5" aria-hidden />}
          note="Returns it to the product page and to the rating. No reason needed to restore something."
          placeholder=""
        />
      )}
    </div>
  );
}

function Decision({
  reviewId,
  to,
  label,
  icon,
  note,
  placeholder,
  destructive,
}: {
  reviewId: string;
  to: ReviewStatus;
  label: string;
  icon: React.ReactNode;
  note: string;
  placeholder: string;
  destructive?: boolean;
}) {
  const [state, submit] = useActionState(moderateReviewAction, null);
  const needsReason = to !== "published";

  return (
    <form action={submit} className="border-border flex flex-col gap-2 rounded-lg border p-3">
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="status" value={to} />

      <p className="text-muted-foreground text-[12.5px]">{note}</p>

      {needsReason && (
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={500}
          placeholder={placeholder}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      )}

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <Submit label={label} icon={icon} destructive={destructive} />
    </form>
  );
}

function Submit({
  label,
  icon,
  destructive,
}: {
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={destructive ? "destructive" : "outline"}
      disabled={pending}
      className="w-fit"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </Button>
  );
}
