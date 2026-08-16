"use client";

import { useState, useTransition } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";

/**
 * "Are you sure?" for actions that are hard to take back.
 *
 * Two things it insists on:
 *
 * 1. **The confirm button names the action.** "Cancel order", not "Confirm" —
 *    a dialog read at speed shows one word, and that word should be the
 *    consequence.
 * 2. **The failure is shown in the dialog**, not swallowed. An action that
 *    fails silently after a confirmation is worse than no confirmation: the
 *    person now believes something happened.
 *
 * Reserve it for the irreversible. A confirmation on a routine action trains
 * people to click through the ones that matter.
 */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  cancelLabel = "Keep it",
  destructive = false,
  action,
  onConfirmed,
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Server action. Returning a failed `ActionResult` shows its message here. */
  action: () => Promise<ActionResult<unknown>>;
  onConfirmed?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {error && (
          <p
            role="alert"
            className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3 py-2 text-[13px]"
          >
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                const result = await action();
                if (result.ok) {
                  setOpen(false);
                  onConfirmed?.();
                } else {
                  // Kept open on failure so the message is attached to the
                  // thing that failed.
                  setError(result.error);
                }
              })
            }
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
