import { headers } from "next/headers";
import { can, getSession, requireVendorOrNull } from "@/lib/auth/dal";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { Payout, type PayoutDoc } from "@/lib/db/models/ledger";
import { objectIdSchema } from "@/validators/common";
import { staffActor, vendorActor, writeAuditLog } from "@/services/audit";
import { createDownloadUrl } from "@/services/storage";

/**
 * `GET /api/payout-evidence/[payoutId]` — the remittance advice, briefly.
 *
 * ## Two audiences, one route
 *
 * Unlike `/api/payment-evidence`, this object has a **legitimate non-staff reader**: the vendor
 * being paid. It is the proof that money left, and withholding it would mean a vendor querying
 * a transfer has to ask us to email them the advice — which is the same document, over a worse
 * channel, with no audit row.
 *
 * So the check is "staff with the permission, **or** a member of the vendor this payout belongs
 * to". Any active member, not only the owner: a member reconciling the books needs the advice,
 * and what the two-role model protects is the payout *account*, not the receipt.
 *
 * ## Order of checks
 *
 * Session, then permission-or-ownership, then id validation — the same order as the payment
 * route and for the same reason. Validating the id first turns the route into an id-format
 * oracle for a caller with no session at all.
 *
 * The redirect target is a 300-second presigned GET. Nothing here reads the bytes, and there is
 * no `url` field on the payout: the bucket answers any known key over plain HTTPS with no
 * signature, so an addressable URL would be a permanent leak of somebody's banking.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ payoutId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user.id) return json(401, "Sign in to view this.");

  const { payoutId } = await context.params;
  const parsed = objectIdSchema.safeParse(payoutId);

  const [mayReadAll, vendorContext] = await Promise.all([
    can("payout.view_all"),
    requireVendorOrNull(),
  ]);

  // Neither staff nor any vendor at all: refuse before touching the database, and before the
  // id is used for anything.
  if (!mayReadAll && !vendorContext) {
    return json(403, "You don't have permission to view payout evidence.");
  }

  if (!parsed.success) return json(404, "No such payout.");

  await connectToDatabase();
  const payout = await Payout.findById(toObjectId(parsed.data)).lean<PayoutDoc>();

  if (!payout?.evidenceKey) return json(404, "No evidence on that payout.");

  const ownsIt = vendorContext && String(payout.vendorId) === vendorContext.vendorId;
  if (!mayReadAll && !ownsIt) {
    // 404, not 403: a vendor asking about a payout that is not theirs must not learn that it
    // exists. The same position the download route and the vendor workspace take.
    return json(404, "No such payout.");
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = requestHeaders.get("user-agent");

  // Before the redirect. A read that fails to log is a read nobody can account for, and this
  // is the record an auditor asks about.
  await writeAuditLog({
    action: "payout.evidence_viewed",
    actor: ownsIt
      ? vendorActor(
          {
            id: session.user.id,
            ...(session.user.name ? { name: session.user.name } : {}),
          },
          vendorContext!.vendorId,
        )
      : staffActor({
          id: session.user.id,
          ...(session.user.name ? { name: session.user.name } : {}),
        }),
    subject: { type: "vendor", id: String(payout.vendorId) },
    after: { reference: payout.reference },
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  });

  const { url } = await createDownloadUrl({
    key: payout.evidenceKey,
    filename: payout.evidenceFilename ?? `${payout.reference}.pdf`,
    ...(payout.evidenceContentType ? { contentType: payout.evidenceContentType } : {}),
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
