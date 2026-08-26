"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { connectGoogleAction, disconnectGoogleAction } from "../actions";
import type { SignInMethods } from "../security-view";

/**
 * How this account can sign in.
 *
 * Both a list and a warning. Somebody with one password and no provider is one
 * forgotten password away from a reset email; somebody with Google and no
 * password cannot disconnect it at all. Saying which situation they are in is
 * more useful than the two rows on their own.
 *
 * The disconnect button is hidden when it would remove the last way in — and the
 * action refuses it again, because a hidden button is not a check.
 */
export function ConnectedAccounts({
  methods,
  googleAvailable,
}: {
  methods: SignInMethods;
  googleAvailable: boolean;
}) {
  const googleLinked = methods.providers.includes("google");
  const isOnlyMethod = googleLinked && !methods.hasPassword && methods.providers.length === 1;

  return (
    <div className="flex flex-col gap-4">
      <ul className="border-border divide-border divide-y rounded-xl border">
        <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="text-[13.5px] font-medium">Email and password</p>
            <p className="text-muted-foreground text-[12px]">
              {methods.hasPassword
                ? "You can sign in with your email address."
                : "No password set, so email sign-in won't work for this account."}
            </p>
          </div>
          <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
            {methods.hasPassword ? "active" : "not set"}
          </span>
        </li>

        {googleAvailable && (
          <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-medium">Google</p>
              <p className="text-muted-foreground text-[12px]">
                {googleLinked
                  ? "Connected — the Google button signs you into this account."
                  : "Not connected."}
              </p>
              {isOnlyMethod && (
                <p className="text-subtle text-[11.5px]">
                  This is your only way to sign in, so it can&rsquo;t be disconnected. Set a
                  password first.
                </p>
              )}
            </div>
            {googleLinked ? isOnlyMethod ? null : <Disconnect /> : <Connect />}
          </li>
        )}
      </ul>
    </div>
  );
}

function Connect() {
  const [state, submit, pending] = useActionState(connectGoogleAction, null);

  return (
    <form action={submit} className="shrink-0">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Opening Google…" : "Connect"}
      </Button>
      {state?.ok === false && (
        <span className="block text-[11.5px] text-[var(--danger)]">{state.error}</span>
      )}
    </form>
  );
}

function Disconnect() {
  const [state, submit, pending] = useActionState(disconnectGoogleAction, null);

  return (
    <form action={submit} className="shrink-0">
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {pending ? "Disconnecting…" : "Disconnect"}
      </Button>
      {state?.ok === false && (
        <span className="block text-[11.5px] text-[var(--danger)]">{state.error}</span>
      )}
    </form>
  );
}
