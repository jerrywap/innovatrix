"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Percent } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setPlatformCommissionAction, setVendorCommissionAction } from "../money-actions";

/**
 * Commission rate forms — vendor ticket 07.
 *
 * Two forms rather than one component with a mode flag, because they are different
 * promises: the platform rate is what everybody pays by default, and the vendor rate is a
 * negotiated exception that can be *cleared* back to the default. A shared component would
 * have to express "empty means inherit" for one and "empty is invalid" for the other, and
 * that is two components wearing one name.
 *
 * Percentages on screen, basis points in the database. `step="0.01"` so a 12.5% rate is
 * typable, and the conversion happens in the action — see `commissionRateSchema`.
 */

/** The platform-wide default, on `/admin/settings/commission`. */
export function PlatformCommissionForm({ percent }: { percent: number }) {
  const [state, submit] = useActionState(setPlatformCommissionAction, null);

  return (
    <form
      action={submit}
      className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-4"
    >
      <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
        <Percent className="text-subtle size-4" aria-hidden />
        Vendor commission
      </h2>

      <p className="text-muted-foreground text-[13px]">
        What CoSetup keeps on a third-party sale, taken on the price after any discount and
        before tax. It applies to every vendor without a rate of their own.
      </p>

      <label className="flex max-w-40 flex-col gap-1.5">
        <span className="text-[13px] font-medium">Our share</span>
        <span className="flex items-center gap-2">
          <Input
            name="percent"
            type="number"
            min={0}
            max={100}
            step={0.01}
            defaultValue={percent}
            required
            className="font-mono tabular-nums"
          />
          <span className="text-muted-foreground text-[13px]">%</span>
        </span>
      </label>

      <p className="text-subtle text-[12px]">
        Future orders only. Every order records the rate it was charged at, so changing this
        never rewrites what a vendor already earned.
      </p>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}

      <Submit />
    </form>
  );
}

/**
 * One vendor's override, on the staff vendor screen.
 *
 * The empty field is load-bearing and the copy says so: clearing it is different from
 * typing today's default, because a cleared vendor follows a later platform change and a
 * pinned one does not.
 */
export function VendorCommissionForm({
  vendorId,
  percent,
  platformPercent,
}: {
  vendorId: string;
  /** `null` when this vendor follows the platform rate. */
  percent: number | null;
  platformPercent: number;
}) {
  const [state, submit] = useActionState(setVendorCommissionAction, null);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="vendorId" value={vendorId} />

      <label className="flex max-w-52 flex-col gap-1.5">
        <span className="text-[13px] font-medium">Our share of their sales</span>
        <span className="flex items-center gap-2">
          <Input
            name="percent"
            type="number"
            min={0}
            max={100}
            step={0.01}
            defaultValue={percent ?? ""}
            placeholder={String(platformPercent)}
            className="font-mono tabular-nums"
          />
          <span className="text-muted-foreground text-[13px]">%</span>
        </span>
      </label>

      <p className="text-subtle text-[12px]">
        {percent === null
          ? `Following the platform rate of ${platformPercent}%. Enter a number to agree a different one with this vendor.`
          : `A rate agreed with this vendor. Clear the field to put them back on the platform rate of ${platformPercent}%, so a later change to it carries them along.`}
      </p>

      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}
      {state?.ok && <p className="text-subtle text-[12.5px]">Saved.</p>}

      <Submit />
    </form>
  );
}

/**
 * `useFormStatus` in a child of the form, which is the only place it reads the
 * surrounding submission — the shared rule for every form in this codebase.
 */
function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save
    </Button>
  );
}
