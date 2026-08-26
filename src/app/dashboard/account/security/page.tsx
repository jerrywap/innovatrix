import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/dal";
import { serverEnv } from "@/config/env";
import { activeSessions, signInMethods } from "@/features/account/security-view";
import { ChangePassword, SetPassword } from "@/features/account/components/password-section";
import { ConnectedAccounts } from "@/features/account/components/connected-accounts";
import { Panel } from "@/features/account/components/panel";
import { SessionList } from "@/features/account/components/session-list";

export const metadata: Metadata = { title: "Security" };

/**
 * Passwords, devices and sign-in methods.
 *
 * The guard runs in this component's body, before any JSX. There is deliberately
 * **no `loading.tsx`** under `/dashboard/account`: once bytes are on the wire the
 * status line is committed, so a boundary over a segment that can refuse renders
 * the refusal under `200 OK`. `loading-boundaries.test.ts` holds that, and the
 * billing sibling refuses with a real 403.
 *
 * Two boundaries rather than one, because the sign-in methods decide which
 * password form to draw and the session list is a separate round trip to Better
 * Auth. Streaming them apart means a slow session list does not hold up the form
 * somebody came here to use.
 */
export default async function Page() {
  await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<Skeleton className="h-80 w-full rounded-xl" />}>
        <PasswordPanel />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-56 w-full rounded-xl" />}>
        <Devices />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-44 w-full rounded-xl" />}>
        <Methods />
      </Suspense>
    </div>
  );
}

async function PasswordPanel() {
  const methods = await signInMethods();

  return methods.hasPassword ? (
    <Panel
      title="Password"
      description="We'll email you whenever it changes, whether or not it was you."
    >
      <ChangePassword />
    </Panel>
  ) : (
    <Panel
      title="Set a password"
      description="This account signs in with Google only. Adding a password gives you a second way in — useful if you ever lose access to that Google account."
    >
      <SetPassword />
    </Panel>
  );
}

async function Devices() {
  const sessions = await activeSessions();

  return (
    <Panel
      title="Where you're signed in"
      description="If you don't recognise one of these, sign it out and change your password."
    >
      {sessions.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">No other sessions.</p>
      ) : (
        <SessionList sessions={sessions} />
      )}
    </Panel>
  );
}

async function Methods() {
  const methods = await signInMethods();

  return (
    <Panel title="Sign-in methods" description="The ways this account can be opened.">
      <ConnectedAccounts methods={methods} googleAvailable={serverEnv().AUTH_GOOGLE_ENABLED} />
    </Panel>
  );
}
