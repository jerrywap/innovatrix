import { headers } from "next/headers";
import { can, getSession } from "@/lib/auth/dal";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Payment, type PaymentDoc } from "@/lib/db/models/commerce";
import { objectIdSchema } from "@/validators/common";
import { staffActor, writeAuditLog } from "@/services/audit";
import { createDownloadUrl } from "@/services/storage";

/**
 * `GET /api/payment-evidence/[paymentId]` — a receipt, briefly.
 *
 * ## This is the most sensitive object the platform stores
 *
 * A bank receipt carries account numbers and somebody's banking. The bucket
 * serves **any known key over plain HTTPS with no signature** — measured, not
 * assumed — so an addressable URL would be a permanent, unauthenticated leak
 * the moment one appeared in a browser history, a referrer or a support email.
 *
 * Hence: no `url` on the `Payment.evidence` field, no `publicObjectUrl()` for
 * this scope, and this route as the only way in. Permission checked, access
 * audited, then a **307 to a five-minute presigned GET**. Same shape as
 * `/api/downloads/[fileId]`, and for a stronger reason.
 *
 * ## Authentication before id validation
 *
 * A malformed id and a real one both return 401 to an anonymous caller. The
 * download route had this the other way round once, which turned it into an
 * id-format oracle for someone with no session at all.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user.id) return json(401, "Sign in to view this.");

  /*
   * `can()` rather than `requirePermission()`: this is a route handler and the
   * status code is ours to choose. `requirePermission` throws `ForbiddenError`,
   * which is right for a server action and would surface here as a 500.
   *
   * `payment.view_all`, deliberately not `payment.record_manual` — recording a
   * transfer and reading somebody's bank details are different jobs.
   */
  if (!(await can("payment.view_all"))) {
    return json(403, "You don't have permission to view payment evidence.");
  }

  const { paymentId } = await context.params;
  const parsed = objectIdSchema.safeParse(paymentId);
  if (!parsed.success) return json(404, "No such payment.");

  await connectToDatabase();
  const payment = await Payment.findById(toObjectId(parsed.data)).lean<PaymentDoc>();

  if (!payment?.evidence?.storageKey) return json(404, "No evidence on that payment.");

  const requestHeaders = await headers();

  // Before the redirect, not after. A read that fails to log is a read nobody
  // can account for, and this is the record an auditor asks about.
  await writeAuditLog({
    action: "payment.evidence_viewed",
    actor: staffActor({
      id: session.user.id,
      ...(session.user.name ? { name: session.user.name } : {}),
    }),
    subject: { type: "payment", id: String(payment._id) },
    organizationId: String(payment.organizationId),
    ...(clientIp(requestHeaders) ? { ip: clientIp(requestHeaders)! } : {}),
    ...(requestHeaders.get("user-agent")
      ? { userAgent: requestHeaders.get("user-agent")! }
      : {}),
  });

  const { url } = await createDownloadUrl({
    key: payment.evidence.storageKey,
    filename: payment.evidence.filename,
    ...(payment.evidence.contentType ? { contentType: payment.evidence.contentType } : {}),
    expiresInSeconds: 300,
  });

  return Response.redirect(url, 307);
}

function json(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function clientIp(requestHeaders: Headers): string | undefined {
  return requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
}
