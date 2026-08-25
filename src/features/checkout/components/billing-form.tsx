"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Gift, Landmark, Lock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FormErrors } from "@/features/products/components/section-form";
import { placeOrderAction } from "../actions";

/**
 * Billing details and the submit — §13.
 *
 * ## One page, not three
 *
 * §13 says "resist adding steps". The flow it describes is
 * `Cart → Account → Billing → Review → Payment`, and for a signed-in customer
 * with one basket that is one screen: the address on the left, the order they
 * are about to place on the right, one button. Splitting it into wizard steps
 * adds three round trips and a place to abandon at each one.
 *
 * ## The idempotency key is minted here, once, on mount
 *
 * Not per render, or every keystroke would produce a new one and the double-
 * submit guard would guard nothing. The server derives its own from the cart's
 * contents when this is absent, so a client that drops it is still protected —
 * this just makes the common case exact.
 */
export function BillingForm({
  defaults,
  idempotencyKey,
  offlineAvailable,
  cardAvailable,
  currency,
  free,
}: {
  defaults: {
    organizationName?: string;
    contactName?: string;
    email?: string;
    line1?: string;
    line2?: string;
    city?: string;
    region?: string;
    postcode?: string;
    country?: string;
    taxId?: string;
  };
  idempotencyKey: string;
  /** False ⇒ bank transfer is not offered. */
  offlineAvailable: boolean;
  /** False ⇒ no provider can take this cart's currency by card. */
  cardAvailable: boolean;
  /** The cart's currency, so the refusal can name it. */
  currency: string;
  /**
   * A £0 basket. Both payment options are nonsense, so neither is rendered and
   * the method stays `online` — which is what the order records, because
   * `paymentMethod` is about *stated intent* and a free order has none. The
   * durable record of its free-ness is `Payment.provider === "free"`.
   *
   * Note what this buys: a free product is checkoutable in a currency no
   * provider covers, because `cardAvailable` never gates this path.
   */
  free: boolean;
}) {
  const [state, formAction] = useActionState(placeOrderAction, null);
  // Default to whatever can actually be paid. Starting on "online" when no
  // provider takes the currency would submit a method the server must refuse.
  const [method, setMethod] = useState<"online" | "offline">(
    free || cardAvailable ? "online" : "offline",
  );
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <FieldGroup title="Who is this for" description="This is what appears on the invoice.">
        <Field label="Organisation" htmlFor="organizationName" required>
          <Input
            id="organizationName"
            name="organizationName"
            defaultValue={defaults.organizationName ?? ""}
            required
            maxLength={200}
            autoComplete="organization"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Contact name" htmlFor="contactName">
            <Input
              id="contactName"
              name="contactName"
              defaultValue={defaults.contactName ?? ""}
              maxLength={120}
              autoComplete="name"
            />
          </Field>

          <Field label="Billing email" htmlFor="email" hint="Where the receipt goes." required>
            <Input
              id="email"
              name="email"
              type="email"
              defaultValue={defaults.email ?? ""}
              required
              autoComplete="email"
            />
          </Field>
        </div>
      </FieldGroup>

      <FieldGroup
        title="Billing address"
        description="The country decides which tax applies, so it's the one field we validate."
      >
        <Field label="Address" htmlFor="line1" required>
          <Input
            id="line1"
            name="line1"
            defaultValue={defaults.line1 ?? ""}
            required
            maxLength={200}
            autoComplete="address-line1"
          />
        </Field>

        <Field label="Address line 2" htmlFor="line2">
          <Input
            id="line2"
            name="line2"
            defaultValue={defaults.line2 ?? ""}
            maxLength={200}
            autoComplete="address-line2"
          />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Town or city" htmlFor="city" required>
            <Input
              id="city"
              name="city"
              defaultValue={defaults.city ?? ""}
              required
              maxLength={120}
              autoComplete="address-level2"
            />
          </Field>

          <Field label="Region" htmlFor="region">
            <Input
              id="region"
              name="region"
              defaultValue={defaults.region ?? ""}
              maxLength={120}
              autoComplete="address-level1"
            />
          </Field>

          <Field label="Postcode" htmlFor="postcode">
            <Input
              id="postcode"
              name="postcode"
              defaultValue={defaults.postcode ?? ""}
              maxLength={40}
              autoComplete="postal-code"
            />
          </Field>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Country"
            htmlFor="country"
            hint="Two-letter code — GB, US, NG."
            required
          >
            <Input
              id="country"
              name="country"
              defaultValue={defaults.country ?? "GB"}
              required
              maxLength={2}
              minLength={2}
              autoComplete="country"
              className="font-mono uppercase"
            />
          </Field>

          <Field label="Tax ID" htmlFor="taxId" hint="VAT number, if you have one.">
            <Input id="taxId" name="taxId" defaultValue={defaults.taxId ?? ""} maxLength={60} />
          </Field>
        </div>
      </FieldGroup>

      {/*
        Said here, before the form is filled in, rather than after it is
        submitted. Card availability depends on the cart's currency and on which
        currencies the merchant's own accounts are provisioned for; a customer
        who finds that out only when they press "place order" has typed an
        address for nothing.
      */}
      {!cardAvailable && !free && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]">
          We can&rsquo;t take a card payment in {currency} at the moment.{" "}
          {offlineAvailable
            ? "You can still order and pay by bank transfer below."
            : "Switch the currency in your basket, or get in touch and we'll sort it out."}
        </p>
      )}

      {!free && (offlineAvailable || !cardAvailable) && (
        <FieldGroup title="How you'd like to pay">
          <div className="flex flex-col gap-2">
            {cardAvailable && (
              <PayOption
                value="online"
                checked={method === "online"}
                onChange={setMethod}
                title="Pay now by card"
                detail="You're taken to our payment provider. Your software is available straight away."
              />
            )}
            {offlineAvailable && (
              <PayOption
                value="offline"
                checked={method === "offline"}
                onChange={setMethod}
                title="Pay by bank transfer"
                detail="We'll place the order and send you the details. Your software is released once we've received the payment — not before."
              />
            )}
          </div>
        </FieldGroup>
      )}

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <PlaceOrder method={method} free={free} />

      {free ? (
        <p className="text-subtle flex items-center gap-1.5 text-[12px]">
          <Gift className="size-3" aria-hidden />
          Nothing to pay. We still need an address for your invoice record.
        </p>
      ) : method === "online" ? (
        <p className="text-subtle flex items-center gap-1.5 text-[12px]">
          <Lock className="size-3" aria-hidden />
          You&rsquo;ll be taken to our payment provider. We never see your card details.
        </p>
      ) : (
        <p className="text-subtle flex items-center gap-1.5 text-[12px]">
          <Landmark className="size-3" aria-hidden />
          Nothing is charged now. We&rsquo;ll show you where to send the payment.
        </p>
      )}
    </form>
  );
}

/**
 * A radio, styled as a card.
 *
 * The **name is on the input**, so the choice is submitted with the form and
 * the server reads it from `FormData` like every other field — no hidden input
 * mirroring React state, which is the version that goes out of sync.
 */
function PayOption({
  value,
  checked,
  onChange,
  title,
  detail,
}: {
  value: "online" | "offline";
  checked: boolean;
  onChange: (next: "online" | "offline") => void;
  title: string;
  detail: string;
}) {
  return (
    <label
      className={
        checked
          ? "border-foreground bg-surface flex cursor-pointer items-start gap-3 rounded-xl border p-3.5"
          : "border-border hover:bg-surface-muted flex cursor-pointer items-start gap-3 rounded-xl border p-3.5"
      }
    >
      <input
        type="radio"
        name="paymentMethod"
        value={value}
        checked={checked}
        onChange={() => onChange(value)}
        className="mt-1"
      />
      <span>
        <span className="block text-[13.5px] font-medium">{title}</span>
        <span className="text-muted-foreground block text-[12.5px]">{detail}</span>
      </span>
    </label>
  );
}

function PlaceOrder({ method, free }: { method: "online" | "offline"; free: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-foreground text-background rounded-full px-5 py-3 text-[14px] font-medium transition hover:opacity-90 disabled:opacity-60"
    >
      {pending
        ? "Placing your order…"
        : free
          ? "Get it free"
          : method === "offline"
            ? "Place order"
            : "Continue to payment"}
    </button>
  );
}
