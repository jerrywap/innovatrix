"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Landmark, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { savePayoutAccountAction } from "../actions";

/**
 * The payout account — vendor ticket 09.
 *
 * Owner-only, on both sides: the page is behind `requireVendorOwner()` and so is the action.
 * It is the one capability the two-role model exists to separate.
 *
 * ## The consequence is stated before the save, not after
 *
 * Changing the account number holds payouts and sends the vendor back through business
 * verification. A vendor who discovers that afterwards concludes something broke; one who
 * reads it first understands it as the protection it is — for them, since the account being
 * hard to change is what makes it hard for somebody else to change.
 *
 * The stored number is shown **masked**. Enough to recognise, not enough to be worth
 * stealing, and a pre-filled full account number is a value sitting in every HTML cache
 * between here and the browser.
 */
export function PayoutAccountForm({
  account,
  verificationStatus,
}: {
  account?: { accountName?: string; masked?: string; bankName?: string; country?: string };
  verificationStatus: string;
}) {
  const [state, submit] = useActionState(savePayoutAccountAction, null);
  const onFile = Boolean(account?.masked);

  return (
    <form action={submit} className="flex flex-col gap-3">
      <h2 className="font-display flex items-center gap-2 text-[15.5px] tracking-[-0.02em]">
        <Landmark className="text-subtle size-4" aria-hidden />
        Where we send your money
      </h2>

      {onFile && (
        <p className="text-muted-foreground text-[13px]">
          Currently paying <span className="font-mono">{account!.masked}</span>
          {account!.bankName ? ` at ${account!.bankName}` : ""}
          {account!.accountName ? `, in the name of ${account!.accountName}` : ""}.
        </p>
      )}

      <p className="flex items-start gap-2.5 rounded-xl border border-[var(--warning)]/40 bg-[var(--warning)]/5 px-4 py-3 text-[13px]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" aria-hidden />
        <span>
          Changing the account number pauses payouts until we have checked the new one against a
          bank document. Nothing else stops — your products stay on sale, your customers keep
          their downloads, and you keep earning.
        </span>
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Name on the account</span>
          <Input
            name="accountName"
            defaultValue={account?.accountName ?? ""}
            required
            maxLength={120}
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Bank</span>
          <Input
            name="bankName"
            defaultValue={account?.bankName ?? ""}
            required
            maxLength={120}
            autoComplete="off"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Account number or IBAN</span>
          {/*
            Never pre-filled, even when one is on file — the masked line above is what tells
            the owner which account is set. `autoComplete="off"` because a browser offering
            to remember a business bank account is not a feature anybody asked for.
          */}
          <Input
            name="accountIdentifier"
            placeholder={onFile ? "Enter it again to change it" : "GB29 NWBK 6016 1331 9268 19"}
            required
            maxLength={64}
            autoComplete="off"
            className="font-mono"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium">Bank&rsquo;s country</span>
          <Input
            name="country"
            defaultValue={account?.country ?? ""}
            required
            maxLength={2}
            placeholder="GB"
            className="uppercase"
          />
        </label>
      </div>

      {verificationStatus !== "approved" && (
        <p className="text-subtle text-[12px]">
          Business verification is {verificationStatus}. Payouts start once it is approved — you
          can sell and earn in the meantime.
        </p>
      )}

      {state?.ok === false && (
        <>
          <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
          {state.fieldErrors &&
            Object.entries(state.fieldErrors).map(([field, messages]) => (
              <p key={field} className="text-[12px] text-[var(--danger)]">
                {field}: {messages.join(" ")}
              </p>
            ))}
        </>
      )}
      {state?.ok && (
        <p className="text-subtle text-[12.5px]">
          Saved. We&rsquo;ll check the new account before the next payout run.
        </p>
      )}

      <Submit />
    </form>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Save account
    </Button>
  );
}
