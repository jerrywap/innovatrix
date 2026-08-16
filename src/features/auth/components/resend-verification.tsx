"use client";

import { useState, useTransition } from "react";
import { resendVerificationAction } from "../actions";

export function ResendVerification() {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <p role="status" className="text-muted-foreground text-[13px]">
        Sent. Check your inbox — and your spam folder.
      </p>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await resendVerificationAction();
          // Shown whatever the outcome: the action is rate-limited server-side,
          // and a failure message here would only invite retry hammering.
          setSent(true);
        })
      }
      className="border-border hover:bg-surface-muted w-fit rounded-full border px-4 py-2 text-[13px] font-medium transition disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send the link again"}
    </button>
  );
}
