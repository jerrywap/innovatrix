"use client";

import { useActionState } from "react";
import { Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { SessionRow } from "../security-view";
import { revokeOtherSessionsAction, revokeSessionAction } from "../actions";

/**
 * Where this account is signed in.
 *
 * The point of the screen is answering "is one of these not me", so each row
 * leads with the device and the last time it was used, and the current one is
 * labelled rather than sorted quietly to the top and left ambiguous.
 *
 * The current session has no sign-out button. Signing yourself out of the page
 * you are reading is what the account menu is for, and a "sign out" that also
 * happens to be a row in a security audit is a confusing way to offer it.
 */
export function SessionList({ sessions }: { sessions: readonly SessionRow[] }) {
  const others = sessions.filter((session) => !session.current).length;

  return (
    <div className="flex flex-col gap-4">
      <ul className="border-border divide-border divide-y rounded-xl border">
        {sessions.map((session) => (
          <li key={session.token} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Monitor className="text-subtle size-4 shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-[13.5px] font-medium">
                {session.device}
                {session.current && (
                  <span className="border-signal/30 bg-signal-soft text-signal-text rounded-full border px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] uppercase">
                    this device
                  </span>
                )}
              </p>
              <p className="text-muted-foreground text-[12px]">
                Last used {session.lastUsedAt}
                {session.ip ? ` · ${session.ip}` : ""}
              </p>
              <p className="text-subtle text-[11.5px]">Signed in {session.signedInAt}</p>
            </div>
            {!session.current && <RevokeOne token={session.token} device={session.device} />}
          </li>
        ))}
      </ul>

      {others > 0 && <RevokeOthers count={others} />}
    </div>
  );
}

function RevokeOne({ token, device }: { token: string; device: string }) {
  const [state, submit, pending] = useActionState(revokeSessionAction, null);

  return (
    <form action={submit} className="shrink-0">
      <input type="hidden" name="token" value={token} />
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Signing out…" : "Sign out"}
        <span className="sr-only"> {device}</span>
      </Button>
      {state?.ok === false && (
        <span className="block text-[11.5px] text-[var(--danger)]">{state.error}</span>
      )}
    </form>
  );
}

function RevokeOthers({ count }: { count: number }) {
  // No `formData` parameter on the action: there is nothing to send, and the
  // session comes from the cookie. `useActionState` still passes previous state,
  // which the action ignores — the same shape as `markAllReadAction`.
  const [state, submit, pending] = useActionState(revokeOtherSessionsAction, null);

  return (
    <form action={submit} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending
          ? "Signing out…"
          : `Sign out of ${count} other ${count === 1 ? "device" : "devices"}`}
      </Button>
      {state?.ok === false && (
        <span className="text-[12px] text-[var(--danger)]">{state.error}</span>
      )}
      {state?.ok && (
        <span role="status" className="text-[12px] text-emerald-700 dark:text-emerald-300">
          Done.
        </span>
      )}
    </form>
  );
}
