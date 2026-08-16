"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { MonitorSmartphone } from "lucide-react";
import { releaseActivationAction } from "../actions";

/**
 * Where this licence is installed — §65.
 *
 * ## Released activations stay visible
 *
 * Greyed out, with their dates. "This has been installed four times and two are
 * live" is a support question, and a released row that vanishes makes it
 * unanswerable — as well as making a customer wonder whether releasing worked.
 */
export interface ActivationRow {
  instanceId: string;
  domain?: string;
  activatedAt: string;
  releasedAt?: string;
}

export function ActivationList({
  entitlementId,
  activationLimit,
  activations,
}: {
  entitlementId: string;
  activationLimit: number;
  activations: readonly ActivationRow[];
}) {
  const live = activations.filter((activation) => !activation.releasedAt);
  const released = activations.filter((activation) => activation.releasedAt);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Installations</h2>
        <p className="text-muted-foreground text-[13px]">
          {live.length} of {activationLimit} in use. Release one to free a slot when you move an
          installation.
        </p>
      </div>

      {activations.length === 0 ? (
        <p className="border-border text-subtle rounded-xl border border-dashed px-4 py-6 text-center text-[12.5px]">
          Not installed anywhere yet. Your software records an installation the first time it
          checks its licence.
        </p>
      ) : (
        <ul className="border-border divide-border divide-y rounded-xl border">
          {[...live, ...released].map((activation) => (
            <li
              key={`${activation.instanceId}-${activation.activatedAt}`}
              className="flex flex-wrap items-center gap-3 px-4 py-3"
            >
              <MonitorSmartphone
                className={`size-4 shrink-0 ${activation.releasedAt ? "text-subtle" : ""}`}
                aria-hidden
              />

              <span className="min-w-0 flex-1">
                <span
                  className={`block truncate text-[13px] ${activation.releasedAt ? "text-subtle line-through" : ""}`}
                >
                  {activation.domain ?? activation.instanceId}
                </span>
                <span className="text-subtle font-mono text-[10.5px]">
                  {activation.domain ? `${activation.instanceId} · ` : ""}
                  since {activation.activatedAt.slice(0, 10)}
                  {activation.releasedAt
                    ? ` · released ${activation.releasedAt.slice(0, 10)}`
                    : ""}
                </span>
              </span>

              {!activation.releasedAt && (
                <ReleaseButton
                  entitlementId={entitlementId}
                  instanceId={activation.instanceId}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReleaseButton({
  entitlementId,
  instanceId,
}: {
  entitlementId: string;
  instanceId: string;
}) {
  const [state, formAction] = useActionState(releaseActivationAction, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      {/* The entitlement id, not the licence key — see `actions.ts`. */}
      <input type="hidden" name="entitlementId" value={entitlementId} />
      <input type="hidden" name="instanceId" value={instanceId} />
      <Submit />
      {state && !state.ok && (
        <span role="alert" className="text-[11.5px] text-[var(--danger)]">
          {state.error}
        </span>
      )}
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border hover:bg-surface-muted rounded-lg border px-3 py-1.5 text-[12px] disabled:opacity-50"
    >
      {pending ? "Releasing…" : "Release"}
    </button>
  );
}
