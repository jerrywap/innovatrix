"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, PauseCircle, PlayCircle, UserMinus } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import type { VendorStatus } from "@/lib/db/enums";
import {
  offboardVendorAction,
  reinstateVendorAction,
  suspendVendorAction,
} from "../lifecycle-actions";

/**
 * Suspend, reinstate, offboard — vendor ticket 12.
 *
 * ## Each control says what survives
 *
 * That is the whole design of this panel. The question a staff member has at the moment of
 * suspending somebody is "what happens to their customers", and the answer — nothing — has to be
 * on the screen where the decision is taken, not in a runbook. A control that only says
 * "Suspend" invites a phone call before every use.
 *
 * ## Offboarding is behind a typed confirmation
 *
 * It is the one irreversible lifecycle action, it usually happens with money still owed, and
 * `VENDOR_TRANSITIONS` has no edge out of `offboarded`. A second click is not a meaningful
 * confirmation for something that cannot be undone; typing the vendor's name is.
 */
export function LifecyclePanel({
  vendorId,
  vendorName,
  status,
  canSuspend,
  canOffboard,
}: {
  vendorId: string;
  vendorName: string;
  status: VendorStatus;
  canSuspend: boolean;
  canOffboard: boolean;
}) {
  if (!canSuspend && !canOffboard) return null;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Lifecycle</h2>

      {canSuspend && status === "verified" && (
        <ReasonForm
          vendorId={vendorId}
          action={suspendVendorAction}
          label="Suspend this vendor"
          icon={<PauseCircle className="size-3.5" aria-hidden />}
          placeholder="Repeated unanswered support threads on a product with an active dispute."
          note={
            "Stops new sales and unlists their products. Existing customers keep their " +
            "entitlements, their licence keys and their downloads; payouts are held; their " +
            "workspace becomes read-only. Reversible in one action."
          }
        />
      )}

      {canSuspend && status === "suspended" && (
        <SimpleForm
          vendorId={vendorId}
          action={reinstateVendorAction}
          label="Reinstate"
          icon={<PlayCircle className="size-3.5" aria-hidden />}
          note={
            "Puts their products back on the marketplace with the same URLs, the same reviews " +
            "and the same publish dates — nothing was unpublished."
          }
        />
      )}

      {canOffboard && (status === "verified" || status === "suspended") && (
        <OffboardForm vendorId={vendorId} vendorName={vendorName} />
      )}

      {status === "offboarded" && (
        <p className="text-muted-foreground border-border rounded-xl border p-4 text-[13px]">
          This vendor has been offboarded. Their customers keep everything they bought, and
          support for those products sits with us now. There is no way back from this state — a
          returning seller applies again.
        </p>
      )}
    </section>
  );
}

type Action = (
  previous: ActionResult<unknown> | null,
  formData: FormData,
) => Promise<ActionResult<unknown>>;

function SimpleForm({
  vendorId,
  action,
  label,
  icon,
  note,
}: {
  vendorId: string;
  action: Action;
  label: string;
  icon: React.ReactNode;
  note: string;
}) {
  const [state, submit] = useActionState(action, null);

  return (
    <form action={submit} className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <input type="hidden" name="vendorId" value={vendorId} />
      <p className="text-muted-foreground text-[13px]">{note}</p>
      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      <Submit label={label} icon={icon} />
    </form>
  );
}

function ReasonForm({
  vendorId,
  action,
  label,
  icon,
  note,
  placeholder,
}: {
  vendorId: string;
  action: Action;
  label: string;
  icon: React.ReactNode;
  note: string;
  placeholder: string;
}) {
  const [state, submit] = useActionState(action, null);

  return (
    <form action={submit} className="border-border flex flex-col gap-2 rounded-xl border p-4">
      <input type="hidden" name="vendorId" value={vendorId} />
      <p className="text-muted-foreground text-[13px]">{note}</p>
      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Reason</span>
        {/* The vendor reads this verbatim on their own dashboard, which is why it is required
            and why the placeholder is a specific sentence rather than "reason". */}
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={1000}
          placeholder={placeholder}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </label>
      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      <Submit label={label} icon={icon} />
    </form>
  );
}

/**
 * Offboarding, with a typed confirmation and an honest summary afterwards.
 *
 * The result carries the outstanding balance and the number of entitlements that survived. Both
 * are shown: the first is work somebody still has to do (a final payout), and the second is the
 * promise this whole ticket exists to keep, stated as a number rather than as a reassurance.
 */
function OffboardForm({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const [state, submit] = useActionState(offboardVendorAction, null);
  const [typed, setTyped] = useState("");

  const confirmed = typed.trim().toLowerCase() === vendorName.trim().toLowerCase();

  if (state?.ok) {
    const data = state.data as {
      outstanding: Array<{ currency: string; amount: number }>;
      preserved: number;
    };

    return (
      <div className="border-border flex flex-col gap-1.5 rounded-xl border p-4 text-[13px]">
        <p className="font-medium">Offboarded.</p>
        <p className="text-muted-foreground">
          {data.preserved} {data.preserved === 1 ? "entitlement" : "entitlements"} left active —
          every customer keeps what they bought, and their downloads still work.
        </p>
        {data.outstanding.length > 0 && (
          <p className="text-[var(--warning)]">
            Still owed:{" "}
            {data.outstanding
              .map((row) => `${row.currency} ${(row.amount / 100).toFixed(2)}`)
              .join(", ")}
            . Run a final payout — the ledger is closed, not cleared.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      action={submit}
      className="flex flex-col gap-2 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/5 p-4"
    >
      <input type="hidden" name="vendorId" value={vendorId} />

      <p className="text-[13px]">
        <strong className="font-medium">Offboarding cannot be undone.</strong> New sales, the
        storefront and their access all end. Every existing entitlement stays active, every
        licence key stays valid, and every download keeps working — support for those products
        transfers to us.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">Reason</span>
        <textarea
          name="reason"
          rows={2}
          required
          maxLength={1000}
          placeholder="Vendor asked to leave; no outstanding disputes."
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium">
          Type <span className="font-mono">{vendorName}</span> to confirm
        </span>
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          className="border-border bg-background rounded-lg border px-3 py-2 text-[13px]"
        />
      </label>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <Submit
        label="Offboard this vendor"
        icon={<UserMinus className="size-3.5" aria-hidden />}
        destructive
        disabled={!confirmed}
      />
    </form>
  );
}

function Submit({
  label,
  icon,
  destructive,
  disabled,
}: {
  label: string;
  icon: React.ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={destructive ? "destructive" : "outline"}
      disabled={pending || disabled}
      className="w-fit"
    >
      {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : icon}
      {label}
    </Button>
  );
}
