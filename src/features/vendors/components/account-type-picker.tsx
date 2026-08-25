"use client";

import { useActionState } from "react";
import { Building2, Loader2, User } from "lucide-react";
import type { VendorAccountType } from "@/lib/db/enums";
import { setAccountTypeAction } from "../actions";

/**
 * Sole trader or company — the first question of verification.
 *
 * ## Why it is here and not on the application form
 *
 * The application is the pitch and the agreement. This decides which documents
 * are asked for, so it belongs at the top of the screen that asks for them,
 * where the consequence of the answer is visible in the same glance.
 *
 * ## Two buttons, not a select
 *
 * There are exactly two answers and each needs a sentence to distinguish it — a
 * dropdown would hide the sentence behind a click and make the difference look
 * smaller than it is. They are separate one-field forms rather than a radio pair
 * with a save button, so choosing *is* submitting: an answer that needed
 * confirming would leave a screen that looks answered and is not.
 */
const OPTIONS: ReadonlyArray<{
  value: VendorAccountType;
  icon: typeof User;
  title: string;
  blurb: string;
}> = [
  {
    value: "individual",
    icon: User,
    title: "An individual",
    blurb:
      "You sell as yourself — a sole trader, a freelancer, or a person with a side project. No company registration to send.",
  },
  {
    value: "business",
    icon: Building2,
    title: "A company",
    blurb:
      "You sell through a registered business. We'll ask for the registration and check the payout account is in the company's name.",
  },
];

export function AccountTypePicker({
  current,
  locked,
}: {
  current?: VendorAccountType;
  /** Payout details already approved — the answer is now part of that decision. */
  locked: boolean;
}) {
  const [state, dispatch, pending] = useActionState(setAccountTypeAction, null);
  const failed = state && !state.ok ? state.error : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {OPTIONS.map((option) => {
          const selected = current === option.value;
          const Icon = option.icon;

          return (
            <form key={option.value} action={dispatch}>
              <input type="hidden" name="accountType" value={option.value} />
              <button
                type="submit"
                disabled={locked || pending}
                aria-pressed={selected}
                className={`flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left transition disabled:cursor-not-allowed ${
                  selected
                    ? "border-[var(--signal)] bg-[var(--signal-soft)]"
                    : "border-border hover:bg-surface-muted"
                } ${locked && !selected ? "opacity-40" : ""}`}
              >
                <span className="flex items-center gap-2">
                  <Icon
                    className={`size-4 ${selected ? "text-[var(--signal-text)]" : "text-subtle"}`}
                    aria-hidden
                  />
                  <span className="text-[13.5px] font-medium">{option.title}</span>
                  {pending && !selected && (
                    <Loader2 className="text-subtle size-3.5 animate-spin" aria-hidden />
                  )}
                </span>
                <span className="text-muted-foreground text-[12.5px] leading-relaxed">
                  {option.blurb}
                </span>
              </button>
            </form>
          );
        })}
      </div>

      {failed && <p className="text-destructive text-[12.5px]">{failed}</p>}

      {locked && (
        <p className="text-subtle text-[12.5px]">
          Your payout details are approved, so this is fixed now. Ask support if it needs to
          change.
        </p>
      )}
    </div>
  );
}
