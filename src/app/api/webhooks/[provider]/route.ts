import { after } from "next/server";
import { DRIVERLESS_PROVIDERS, PAYMENT_PROVIDERS, type PaymentProvider } from "@/lib/db/enums";
import { connectToDatabase } from "@/lib/db/client";
import { log } from "@/lib/logger";
import { alert, ALERTS } from "@/lib/alerts";
import { webhookEvents } from "@/repositories/webhook-event.repository";
import { SignatureError } from "@/services/payments/provider";
import { driverFor } from "@/services/payments/registry";
import { processWebhookEvent } from "@/services/payments/webhook-processor";

/**
 * Payment webhooks — §87.
 *
 * ## Public and unauthenticated by design
 *
 * The signature **is** the authentication. There is no session here and there
 * must not be — the caller is Stripe, not a person. `proxy.ts` excludes this
 * path from its matcher for the same reason, and because nothing may sit in
 * front of the raw bytes.
 *
 * ## The order of operations is the ticket, verbatim
 *
 * ```
 * await req.text()      ← the exact bytes, before any parsing
 * verify signature      ← invalid: 400, log, stop
 * check (provider, id)  ← known: 200 immediately, duplicates are normal
 * persist as "received"
 * return 200            ← fast, before any work
 * after(() => process)  ← the work
 * ```
 *
 * Returning 200 *before* processing is not laziness. Providers retry on a slow
 * response, so doing the work inline turns one payment into several delivery
 * attempts of the same event — and the retry storm arrives exactly when the
 * system is already struggling.
 *
 * ## Nothing internal leaks into a response body
 *
 * The endpoint is public. A stack trace or a database message in the body is
 * reconnaissance for anyone who cares to POST at it.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider: raw } = await context.params;

  // A driverless provider has nothing that could post here — `manual` is a bank
  // transfer staff confirm, `free` is a £0 order settled in-process — so the
  // route must 404 rather than reach `driverFor` and throw.
  if (
    !(PAYMENT_PROVIDERS as readonly string[]).includes(raw) ||
    (DRIVERLESS_PROVIDERS as readonly string[]).includes(raw)
  ) {
    return json({ error: "Unknown provider." }, 404);
  }
  const provider = raw as PaymentProvider;

  // **First.** Reading the body any other way — `request.json()`, a framework
  // parser — consumes the stream and leaves nothing to verify a signature over.
  const rawBody = await request.text();

  let parsed;
  try {
    parsed = await driverFor(provider).parseWebhook({ rawBody, headers: request.headers });
  } catch (error) {
    if (error instanceof SignatureError) {
      /*
       * An **alert**, not a warning — §95 names this explicitly.
       *
       * A provider whose signature stops verifying means either a rotated
       * secret we did not follow (every payment silently stops being
       * confirmed) or somebody forging callbacks. Both need a person.
       *
       * Never the body or the headers: a failed signature is often an attacker
       * probing, and echoing their input back into a log helps them.
       */
      alert(ALERTS.webhookVerificationFailed, "Webhook signature did not verify", {
        provider,
        bytes: rawBody.length,
      });
      return json({ error: "Invalid signature." }, 400);
    }

    log.exception("Could not parse a webhook payload", error, {
      code: "webhook.unparseable",
      provider,
    });
    // 400, not 500: a payload we cannot parse will not parse on retry either.
    return json({ error: "Malformed payload." }, 400);
  }

  try {
    await connectToDatabase();

    const { event, isDuplicate } = await webhookEvents.record({
      provider,
      eventId: parsed.eventId,
      eventType: parsed.type,
      // The normalised form is stored alongside the raw event so the processor
      // never re-parses — and so a driver change cannot alter how an already
      // received event is interpreted.
      payload: { __parsed: parsed, raw: parsed.raw },
    });

    if (isDuplicate) {
      // §87: duplicate delivery is normal, not an error.
      return json({ received: true, duplicate: true }, 200);
    }

    const eventId = String(event._id);

    // The response goes out first; this runs after it. Crash safety comes from
    // the row we just wrote — the sweep re-drives anything still `received`.
    after(async () => {
      try {
        await processWebhookEvent(eventId);
      } catch (error) {
        // Not an alert: the event row survives and `reconcile-pending-payments`
        // re-drives it within fifteen minutes. It becomes an alert only if that
        // sweep also fails, which dead-letters the job.
        log.exception("Webhook processing failed", error, {
          code: "webhook.processing_failed",
          provider,
          eventId,
        });
      }
    });

    return json({ received: true }, 200);
  } catch (error) {
    log.exception("Could not record a webhook event", error, {
      code: "webhook.not_recorded",
      provider,
    });
    // 500 so the provider *does* retry: we failed to persist, so the event is
    // genuinely lost unless they send it again.
    return json({ error: "Could not record event." }, 500);
  }
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
