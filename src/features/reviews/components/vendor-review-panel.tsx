"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Flag, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { REVIEW_REPORT_REASONS } from "@/lib/db/enums";
import { reportReviewAsVendorAction, respondToReviewAction } from "../actions";

/**
 * What a vendor may do about a review of their own product — vendor ticket 10.
 *
 * Exactly two things, and the shape of this component is the argument: **reply**, publicly, and
 * **report**, to ask somebody else to look. There is no hide, no remove, no edit, and no
 * permission anywhere that would open one — a seller who can suppress criticism of their own
 * product makes every remaining review worthless, including the good ones.
 *
 * The reply is edit-visible. A vendor rewriting their answer after the fact is fine; doing it
 * invisibly is not, because the buyer reading it is trying to judge how this seller behaves.
 */
export function VendorReviewPanel({
  reviewId,
  existingResponse,
}: {
  reviewId: string;
  existingResponse?: string;
}) {
  const [mode, setMode] = useState<"idle" | "reply" | "report">("idle");

  if (mode === "reply") {
    return (
      <ResponseForm
        reviewId={reviewId}
        existingResponse={existingResponse}
        onCancel={() => setMode("idle")}
      />
    );
  }

  if (mode === "report") {
    return <ReportForm reviewId={reviewId} onCancel={() => setMode("idle")} />;
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => setMode("reply")}>
        <MessageSquare className="size-3.5" aria-hidden />
        {existingResponse ? "Edit your reply" : "Reply publicly"}
      </Button>
      <Button type="button" variant="ghost" onClick={() => setMode("report")}>
        <Flag className="size-3.5" aria-hidden />
        Report it
      </Button>
    </div>
  );
}

function ResponseForm({
  reviewId,
  existingResponse,
  onCancel,
}: {
  reviewId: string;
  existingResponse?: string;
  onCancel: () => void;
}) {
  const [state, submit] = useActionState(respondToReviewAction, null);

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Your public reply</span>
        <textarea
          name="body"
          rows={3}
          required
          maxLength={2000}
          defaultValue={existingResponse ?? ""}
          placeholder="Thanks for the detail — the import bug you hit is fixed in 2.1."
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
        />
        <span className="text-subtle text-[12px]">
          Everybody reading the product page sees this, next to the review. Answering a specific
          complaint is worth more to the next buyer than defending the product in general.
        </span>
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Posted.</p>}

      <div className="flex gap-2">
        <Submit label={existingResponse ? "Save reply" : "Post reply"} />
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * Reporting, with a reason from a closed set.
 *
 * The reasons are an enum so the moderation queue can be sorted and counted, and so that
 * "forty reports, all 'other'" is not the state the queue arrives in. `other` requires a note,
 * which the service enforces rather than the form alone.
 */
function ReportForm({ reviewId, onCancel }: { reviewId: string; onCancel: () => void }) {
  const [state, submit] = useActionState(reportReviewAsVendorAction, null);

  return (
    <form action={submit} className="flex flex-col gap-2">
      <input type="hidden" name="reviewId" value={reviewId} />

      <label className="flex max-w-56 flex-col gap-1.5">
        <span className="text-[13px] font-medium">What is wrong with it?</span>
        <select
          name="reason"
          required
          className="border-border bg-background h-9 rounded-lg border px-2 text-[13px]"
        >
          {REVIEW_REPORT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {REASON_LABELS[reason]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Anything else we should know</span>
        <textarea
          name="detail"
          rows={2}
          maxLength={1000}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13.5px]"
        />
        <span className="text-subtle text-[12px]">
          Reporting asks us to look at it. It does not hide the review, and the customer is not
          told who reported it.
        </span>
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && (
        <p className="text-subtle text-[12.5px]">Reported. Somebody will read it.</p>
      )}

      <div className="flex gap-2">
        <Submit label="Report" />
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const REASON_LABELS: Record<string, string> = {
  spam: "Spam or advertising",
  abusive: "Abusive or personal",
  off_topic: "Not about this product",
  misleading: "Factually wrong",
  other: "Something else",
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}
