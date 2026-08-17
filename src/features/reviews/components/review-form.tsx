"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Star } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { editReviewAction, submitReviewAction } from "../actions";

/**
 * Write or edit a review — vendor ticket 10.
 *
 * One component for both, because they are the same form with a different verb and a
 * different hidden id. Splitting them would mean two places to keep the star control, the
 * character floor and the copy in step.
 *
 * ## The stars are radio inputs
 *
 * Not buttons with `useState` driving a hidden field. A radio group is keyboard-navigable with
 * arrow keys for free, announces "3 of 5" without an `aria-label` per star, and submits
 * without JavaScript having to marshal anything. The visual fill is `peer-checked` styling
 * over real inputs — the hover preview is the only thing `useState` is for.
 */
export function ReviewForm({
  entitlementId,
  existing,
  productName,
}: {
  entitlementId: string;
  /** Present ⇒ editing. The rating and text are pre-filled and the id is carried. */
  existing?: { id: string; rating: number; title?: string; body: string };
  productName: string;
}) {
  /*
   * One `useActionState`, chosen by which mode this is.
   *
   * The two actions return different payloads (`{ reviewId }` vs `{ saved }`), and this form
   * reads neither — only `ok` and the error. The cast narrows them to the shape actually used
   * rather than making both actions return a union that exists for one component's benefit.
   */
  const action = (existing ? editReviewAction : submitReviewAction) as (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  const [state, submit] = useActionState(action, null);
  const [hovered, setHovered] = useState<number | null>(null);
  const [chosen, setChosen] = useState(existing?.rating ?? 0);

  const shown = hovered ?? chosen;

  return (
    <form action={submit} className="border-border flex flex-col gap-4 rounded-xl border p-5">
      {existing ? (
        <input type="hidden" name="reviewId" value={existing.id} />
      ) : (
        <input type="hidden" name="entitlementId" value={entitlementId} />
      )}

      <div>
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
          {existing ? "Edit your review" : `Review ${productName}`}
        </h2>
        <p className="text-muted-foreground mt-0.5 text-[13px]">
          {existing
            ? "Your review will show that it was edited."
            : "Other buyers see this on the product page, with your first name and last initial."}
        </p>
      </div>

      <fieldset
        className="flex flex-col gap-1.5"
        onMouseLeave={() => setHovered(null)}
        // A real fieldset with a legend, so the group has a name of its own rather than
        // relying on five stars each announcing a number.
      >
        <legend className="text-[13px] font-medium">Your rating</legend>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((value) => (
            <label
              key={value}
              className="cursor-pointer"
              onMouseEnter={() => setHovered(value)}
            >
              <input
                type="radio"
                name="rating"
                value={value}
                required
                defaultChecked={existing?.rating === value}
                onChange={() => setChosen(value)}
                className="peer sr-only"
              />
              <span className="peer-focus-visible:ring-signal/50 block rounded peer-focus-visible:ring-2">
                <Star
                  className={cn(
                    "size-6 transition",
                    value <= shown
                      ? "fill-[var(--signal)] text-[var(--signal)]"
                      : "text-border",
                  )}
                  strokeWidth={1.5}
                />
              </span>
              <span className="sr-only">
                {value} {value === 1 ? "star" : "stars"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Headline <span className="text-subtle font-normal">(optional)</span>
        </span>
        <Input name="title" maxLength={120} defaultValue={existing?.title ?? ""} />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Your review</span>
        <textarea
          name="body"
          rows={5}
          required
          minLength={20}
          maxLength={4000}
          defaultValue={existing?.body ?? ""}
          placeholder="What did it do well? What would you warn the next buyer about?"
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
        />
        <span className="text-subtle text-[12px]">
          A sentence or two is plenty. Reviews of what the software does are more useful than
          reviews of the buying experience.
        </span>
      </label>

      {state?.ok === false && (
        <>
          <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
          {state.fieldErrors &&
            Object.values(state.fieldErrors).map((messages, index) => (
              <p key={index} className="text-[12px] text-[var(--danger)]">
                {messages.join(" ")}
              </p>
            ))}
        </>
      )}
      {state?.ok && (
        <p className="text-subtle text-[12.5px]">Thank you — it is live on the product page.</p>
      )}

      <Submit label={existing ? "Save changes" : "Publish review"} />
    </form>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}
