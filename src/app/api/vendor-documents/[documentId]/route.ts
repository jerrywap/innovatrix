import { headers } from "next/headers";
import { can, getSession, requireVendorOrNull } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { staffActor, writeAuditLog } from "@/services/audit";
import { findDocument } from "@/services/vendors/document-service";
import { createDownloadUrl } from "@/services/storage";

/**
 * Reading a vendor's verification document — vendor ticket 02.
 *
 * Modelled on `/api/payment-evidence/[paymentId]`, and the four things it does in
 * this order are all load-bearing:
 *
 * 1. **Authenticate before validating the id.** Reversed, the route is an
 *    id-format oracle for anonymous callers — a malformed id gets 404 and a
 *    well-formed one gets 401, which tells an unauthenticated stranger what a real
 *    id looks like.
 * 2. **`can()`, not `requirePermission()`.** The latter throws `ForbiddenError`,
 *    which in a route handler surfaces as a 500 with a redacted digest rather than
 *    the 403 the caller can act on.
 * 3. **Audit before the redirect.** Once the 307 is written the request is over;
 *    an audit row after it is a row that may never exist. A KYC document is
 *    exactly the thing somebody should have to explain looking at, so every read
 *    is recorded against the reader — see the two audiences below.
 * 4. **307 to a short-lived presigned GET.** Never `GetObject` into a `Response`:
 *    bytes do not pass through this server, and `publicObjectUrl()` is not
 *    reachable from here — the bucket answers any known key over plain HTTPS with
 *    no signature, so an unguessable URL is not protection for a passport scan.
 *
 * ## Two audiences, and the second one is not a loosening
 *
 * This was staff-only, on the reasoning that "the only reason to fetch a stored
 * ID document is to check it, which is staff work" and that "if a vendor needs to
 * see what they sent, they have the original".
 *
 * Both halves turned out to be wrong in practice. The vendor's own screen renders
 * every document as a link to this route, so the narrower rule did not remove the
 * control — it left one that always answered 403, which reads as a broken product
 * rather than as a policy. And "they have the original" assumes a person
 * remembers which of four photos of a passport they actually sent, which is
 * exactly what somebody wants to check when a level is rejected.
 *
 * It is also not a disclosure: the caller is being handed bytes they uploaded
 * themselves. So the rule is **either** the staff permission **or** active
 * membership of the vendor the document belongs to — never a session that is
 * merely signed in, and never a vendor reading another vendor's file.
 *
 * The two paths differ in what is recorded. Staff get `vendor_document.viewed`
 * with a staff actor, because a KYC document is exactly the thing somebody should
 * have to explain looking at. A vendor reading their own gets
 * `vendor_document.viewed_own` with a customer actor — a different fact, and
 * mislabelling it would quietly inflate the staff-access record that exists to be
 * audited.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user.id) return json(401, "Sign in to view this.");

  /*
   * Staff permission decided up front, vendor membership after the lookup —
   * because the second needs the document to know *which* vendor to compare
   * against, and the first must not wait for a database read that a stranger
   * could otherwise use for timing.
   */
  const isStaff = await can("vendor.view_documents");
  const ownVendorId = isStaff ? null : ((await requireVendorOrNull())?.vendorId ?? null);
  if (!isStaff && !ownVendorId) {
    return json(403, "You don't have permission to view vendor documents.");
  }

  const { documentId } = await context.params;
  const parsed = objectIdSchema.safeParse(documentId);
  if (!parsed.success) return json(404, "No such document.");

  const document = await findDocument(parsed.data);
  if (!document) return json(404, "No such document.");

  // A vendor reading somebody else's document gets the same answer as a vendor
  // reading one that does not exist. Distinguishing them would confirm the id.
  if (!isStaff && String(document.vendorId) !== ownVendorId) {
    return json(404, "No such document.");
  }

  // Purged means the object should no longer exist. Say so rather than issuing a
  // signed URL that will 404 at the bucket and read as a broken page.
  if (document.purgedAt) {
    return json(410, "That document was removed after the verification decision.");
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = requestHeaders.get("user-agent");

  await writeAuditLog({
    action: isStaff ? "vendor_document.viewed" : "vendor_document.viewed_own",
    actor: isStaff
      ? staffActor({
          id: session.user.id,
          ...(session.user.name ? { name: session.user.name } : {}),
        })
      : {
          type: "customer",
          userId: session.user.id,
          ...(session.user.name ? { name: session.user.name } : {}),
        },
    source: isStaff ? "staff" : "vendor",
    subject: { type: "vendor", id: String(document.vendorId) },
    after: { documentId: String(document._id), level: document.level, kind: document.kind },
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
  });

  const { url } = await createDownloadUrl({
    key: document.storageKey,
    filename: document.filename,
    contentType: document.contentType,
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
