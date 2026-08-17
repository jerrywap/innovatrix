import "server-only";
import type {
  PayoutInstruction,
  PayoutProviderDriver,
  PayoutResult,
  PayoutStatusResult,
} from "../provider";

/**
 * The `manual` driver — vendor ticket 09's only driver at launch.
 *
 * ## A driver, not an absence of one
 *
 * The payment side took the opposite view: `driverFor("manual")` **throws**, because a bank
 * transfer *in* has no provider and asking for one is a bug in the caller. Outbound is
 * different, and the difference is worth stating rather than mirroring the decision blindly:
 * inbound, the customer acts and we react; outbound, *we* act, and there is a real sequence
 * of steps — instruct, wait, confirm — whoever performs them. Making `manual` a driver means
 * that sequence lives in the service for every method, and the whole outbound path is
 * exercisable without a provider account.
 *
 * So `send()` reports `sent` rather than doing anything. The transfer happens in somebody's
 * banking app, and a staff member records the bank reference and the remittance advice
 * against the payout afterwards. That is exactly the shape offline *payment* recording
 * already has, working, at `/admin/payments`.
 *
 * `isConfigured()` is always true: the configuration is a person with access to the bank
 * account, and there is nothing in the environment to check.
 */
export class ManualPayoutDriver implements PayoutProviderDriver {
  readonly key = "manual";

  isConfigured(): boolean {
    return true;
  }

  /**
   * Any currency, any country.
   *
   * A person deciding whether they can make a transfer is not something this code can
   * model, and pretending otherwise would produce a skip reason nobody could act on. The
   * gates that do apply — verification, threshold, an account on file — are the service's,
   * and they apply to every driver.
   */
  supports(): boolean {
    return true;
  }

  async send(instruction: PayoutInstruction): Promise<PayoutResult> {
    /*
     * Nothing to call, and nothing to fake.
     *
     * Returning `sent` with no external reference is the honest answer: the money has not
     * moved, somebody has to move it, and the payout sits in `sending` until they record
     * that they did. A driver that returned `paid` here would put "we paid you" on a
     * vendor's screen on the strength of a button click.
     */
    return {
      status: "sent",
      raw: { instructed: instruction.reference, method: "manual" },
    };
  }

  /**
   * There is nobody to ask.
   *
   * `verify` exists on the interface because an automated driver needs it, and answering
   * "still sending" is the only thing this one can truthfully say. The stuck-payout sweep
   * therefore surfaces a manual payout for a **person** to look at rather than resolving it
   * — which is right: the person is the provider.
   */
  async verify(): Promise<PayoutStatusResult> {
    return { status: "sending" };
  }
}
