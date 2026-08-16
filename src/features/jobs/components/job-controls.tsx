"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, RotateCcw, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cancelJobAction, retryJobAction, runQueueNowAction } from "../actions";

/**
 * The three controls on `/admin/jobs`.
 *
 * `"use client"` for `useActionState` and `useFormStatus` — the pending state
 * matters here more than on most forms, because "run now" takes ten seconds and
 * a button that looks idle gets pressed again.
 */

function Pending({ children, label }: { children: React.ReactNode; label: string }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : children}
      {label}
    </Button>
  );
}

export function RetryJob({ jobId }: { jobId: string }) {
  const [state, submit] = useActionState(retryJobAction, null);

  return (
    <form action={submit} className="flex items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Pending label="Retry">
        <RotateCcw className="size-3.5" aria-hidden />
      </Pending>
      {state && !state.ok && (
        <span className="text-[12px] text-red-600 dark:text-red-400">{state.error}</span>
      )}
    </form>
  );
}

export function CancelJob({ jobId }: { jobId: string }) {
  const [state, submit] = useActionState(cancelJobAction, null);

  return (
    <form action={submit} className="flex items-center gap-2">
      <input type="hidden" name="jobId" value={jobId} />
      <Pending label="Cancel">
        <X className="size-3.5" aria-hidden />
      </Pending>
      {state && !state.ok && (
        <span className="text-[12px] text-red-600 dark:text-red-400">{state.error}</span>
      )}
    </form>
  );
}

export function RunQueueNow() {
  const [state, submit] = useActionState(
    // `useActionState` insists on a (prev, payload) signature; this action
    // takes no input, so the wrapper discards both rather than inventing a
    // FormData the action would ignore.
    async () => runQueueNowAction(),
    null,
  );

  return (
    <form action={submit} className="flex items-center gap-3">
      <Pending label="Run now">
        <Play className="size-3.5" aria-hidden />
      </Pending>
      {state?.ok && (
        <span className="text-muted-foreground text-[12.5px]">
          {state.data.claimed === 0
            ? "Nothing was due."
            : `Ran ${state.data.claimed} job${state.data.claimed === 1 ? "" : "s"}` +
              (state.data.dead > 0 ? `, ${state.data.dead} dead-lettered.` : ".")}
        </span>
      )}
      {state && !state.ok && (
        <span className="text-[12.5px] text-red-600 dark:text-red-400">{state.error}</span>
      )}
    </form>
  );
}
