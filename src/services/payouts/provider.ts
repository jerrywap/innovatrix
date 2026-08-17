import "server-only";
import type { Money } from "@/lib/money";

/**
 * One interface, outbound — vendor ticket 09.
 *
 * §62's provider abstraction is entirely **inbound**: four drivers, every one of which
 * collects. This is the mirror image, and it deliberately mirrors it rather than inventing a
 * second shape — an interface, drivers behind it, and the same rule that matters most:
 *
 * **A driver never writes domain state.** It talks to the outside and returns a result; the
 * service decides what that means. A driver that marked a payout `paid` would make "the
 * transaction is the authority" untrue in as many places as there are drivers, and this is
 * the one part of the system where being wrong costs money that is already gone.
 *
 * ## What is deliberately *not* here
 *
 * No `initiate`/`redirect` pair. Nobody is at a browser when a payout goes out — it is a
 * server-to-server transfer with no user in the loop, which is also why `approve` is a human
 * decision recorded before any driver is asked to do anything.
 */

export interface PayoutInstruction {
  /** Our reference (`POU-YYYY-NNNN`), to quote on the transfer. */
  reference: string;
  amount: Money;
  /** Who is being paid, as the vendor gave it to us. */
  account: {
    accountName?: string;
    accountIdentifier?: string;
    bankName?: string;
    country?: string;
  };
  vendor: { id: string; displayName: string; contactEmail: string };
}

export interface PayoutResult {
  /**
   * `sent` — the instruction is with the bank and we are waiting.
   * `paid` — settled, and the service may close it in one step.
   * `failed` — refused; `failureReason` says why, and the ledger entries go back.
   */
  status: "sent" | "paid" | "failed";
  /** The bank's own reference, once there is one. */
  externalReference?: string;
  failureReason?: string;
  /** The provider's own payload, kept verbatim for a dispute. */
  raw?: unknown;
}

export interface PayoutStatusResult {
  status: "sending" | "paid" | "failed";
  failureReason?: string;
  paidAt?: Date;
  raw?: unknown;
}

export interface PayoutProviderDriver {
  readonly key: string;

  /** Is this driver usable — are its secrets present? */
  isConfigured(): boolean;

  /**
   * Whether this driver can pay into that account, in that currency.
   *
   * Asked before a batch drafts, so "we cannot pay you in NGN" is a skip with a reason
   * rather than a failure after somebody approved it.
   */
  supports(input: { currency: string; country?: string }): boolean;

  send(instruction: PayoutInstruction): Promise<PayoutResult>;

  /** Authoritative, server-to-server. For a payout stuck in `sending`. */
  verify(externalReference: string): Promise<PayoutStatusResult>;
}

/** Something went wrong at the provider rather than in our code. */
export class PayoutProviderError extends Error {
  constructor(
    message: string,
    readonly providerKey: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "PayoutProviderError";
  }
}
