"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { requireVendor } from "@/lib/auth/dal";
import { staffActor } from "@/services/audit";
import { markProvided } from "@/services/checkout/provisioning-service";
import { postMessage } from "@/services/messaging/messaging-service";

/**
 * Handing over a paid plugin.
 *
 * ## The body is required, and that is the feature
 *
 * A plugin is delivered off this platform — a key, a licence code, an account on
 * a third-party API. There is nothing the platform can hand over on the vendor's
 * behalf, so the only evidence that anything happened is what the vendor writes.
 * A task that could be closed with an empty message is one that gets closed
 * without the key being sent, and the customer finds out by waiting.
 *
 * ## The vendor never learns who they are writing to
 *
 * There is no orders or customers screen under `/dashboard/selling`, deliberately.
 * The vendor marks a **line** provided and writes what it needs; the platform is
 * the only thing that knows which organisation reads the thread. That is why this
 * action takes an order reference and a line id rather than a recipient.
 */

const schema = z.object({
  orderReference: z.string().trim().min(1),
  lineId: z.string().trim().min(1),
  body: z
    .string()
    .trim()
    .min(1, "Say what you're handing over — this is what the customer receives.")
    .max(4000),
});

export async function markPluginProvidedAction(
  _previous: ActionResult<unknown> | null,
  formData: FormData,
): Promise<ActionResult<never>> {
  return withAction<never>(async () => {
    // A server action is a public POST. The vendor scope comes from the session
    // and never from the form — a `vendorId` field here would be a claim.
    const { vendorId, user } = await requireVendor();

    const input = parseInput(schema, {
      orderReference: formData.get("orderReference"),
      lineId: formData.get("lineId"),
      body: formData.get("body"),
    });

    const { order } = await markProvided(
      { orderReference: input.orderReference, lineId: input.lineId },
      { vendorId },
      staffActor({ id: user.id, name: user.name }),
    );

    /*
     * The key travels in the thread and nowhere else.
     *
     * Not the order document (projected wholesale into admin views), not the
     * audit `after` payload, not the notification body. Posted after the state
     * moved, so a failure here leaves a provided line and an unsent message —
     * recoverable by writing again — rather than a sent key and a line that still
     * looks owed.
     */
    await postMessage({
      organizationId: String(order.organizationId),
      subjectType: "order",
      subjectId: String(order._id),
      subjectReference: order.reference,
      senderUserId: user.id,
      senderType: "vendor",
      body: input.body,
      // Explicitly `customer`: the point is that the buyer reads it. A `vendor`
      // visibility would file the key as a note to us and deliver nothing.
      visibility: "customer",
    });

    revalidatePath("/dashboard/selling/plugins");
    return ok(undefined as never);
  });
}
