"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { CircleAlert, Loader2 } from "lucide-react";
import { pollOrderStatus } from "../order-status";

/**
 * "Confirming your payment" — §13, §103.
 *
 * ## It reflects server state and nothing else
 *
 * The customer arrives here from the payment provider's redirect. That redirect
 * says nothing: it fires when the *browser* comes back, which happens before —
 * and sometimes without — the webhook that actually confirms the money. §13 is
 * explicit that a frontend success redirect is never payment confirmation, so
 * this page starts pessimistic and only changes when the server says so.
 *
 * ## The backoff, and why it gives up out loud
 *
 * Polling every second forever is a denial-of-service against your own database
 * from a page nobody is watching. The interval grows, and after ninety seconds
 * it stops and offers support — because a payment that has not confirmed in
 * ninety seconds usually needs a person, and a spinner that never resolves
 * tells the customer nothing while implying everything is fine.
 */
const FIRST_DELAY_MS = 1_500;
const MAX_DELAY_MS = 8_000;
const GIVE_UP_AFTER_MS = 90_000;

export function ProcessingPoller({ reference }: { reference: string }) {
  const router = useRouter();
  const [state, setState] = useState<"waiting" | "paid" | "timeout" | "unknown">("waiting");
  // Not `useRef(Date.now())`: calling it during render is impure, and React's
  // `no-impure-function-during-render` rule flags it. The clock starts when the
  // effect runs, which is the moment polling actually begins anyway.
  const startedAt = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = FIRST_DELAY_MS;
    startedAt.current = Date.now();

    const tick = async () => {
      if (cancelled) return;

      const result = await pollOrderStatus(reference);
      if (cancelled) return;

      if (result.status === "unknown") {
        setState("unknown");
        return;
      }

      if (result.paid) {
        setState("paid");
        router.replace(`/orders/${reference}/confirmation` as Route);
        return;
      }

      if (Date.now() - startedAt.current > GIVE_UP_AFTER_MS) {
        setState("timeout");
        return;
      }

      delay = Math.min(delay * 1.5, MAX_DELAY_MS);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, FIRST_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [reference, router]);

  if (state === "unknown") {
    return (
      <Panel
        icon={<CircleAlert className="size-5 text-[var(--danger)]" aria-hidden />}
        title="We can't find that order"
        body="Check the link, or get in touch and we'll look it up."
        reference={reference}
      />
    );
  }

  if (state === "timeout") {
    return (
      <Panel
        icon={<CircleAlert className="size-5 text-amber-600 dark:text-amber-400" aria-hidden />}
        title="This is taking longer than usual"
        body={
          "Your payment may still be going through — we haven't lost it, and nothing is charged " +
          "twice if you wait. Quote the reference below and we'll check for you."
        }
        reference={reference}
      />
    );
  }

  return (
    <Panel
      icon={<Loader2 className="size-5 animate-spin" aria-hidden />}
      title={state === "paid" ? "Payment confirmed" : "Confirming your payment"}
      body={
        state === "paid"
          ? "Taking you to your order…"
          : "We're waiting for your payment provider to confirm. This usually takes a few seconds — please don't close this page."
      }
      reference={reference}
    />
  );
}

function Panel({
  icon,
  title,
  body,
  reference,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  reference: string;
}) {
  return (
    <div className="border-border bg-surface mx-auto flex max-w-[520px] flex-col items-center gap-4 rounded-xl border px-6 py-12 text-center">
      {icon}
      <h1 className="font-display text-[20px] tracking-[-0.02em]">{title}</h1>
      <p className="text-muted-foreground max-w-[44ch] text-[13.5px] leading-relaxed">{body}</p>

      <p className="text-subtle font-mono text-[11.5px]">{reference}</p>

      <output aria-live="polite" className="sr-only">
        {title}
      </output>

      <Link
        href={"/contact" as Route}
        className="text-subtle text-[12.5px] underline underline-offset-4"
      >
        Get help with this order
      </Link>
    </div>
  );
}
