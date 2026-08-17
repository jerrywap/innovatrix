import { headers } from "next/headers";
import { can, getSession } from "@/lib/auth/dal";
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
 *    exactly the thing somebody should have to explain looking at, so the read is
 *    recorded against the staff member's name every single time.
 * 4. **307 to a short-lived presigned GET.** Never `GetObject` into a `Response`:
 *    bytes do not pass through this server, and `publicObjectUrl()` is not
 *    reachable from here — the bucket answers any known key over plain HTTPS with
 *    no signature, so an unguessable URL is not protection for a passport scan.
 *
 * ## Staff only, deliberately — including the vendor
 *
 * The vendor uploaded it and can see *that* it is there, from the filename on
 * their own screen. They cannot re-read the bytes through this route, and that is
 * not an oversight: the only reason to fetch a stored ID document is to check it,
 * which is staff work, and a read path that serves two audiences is one where the
 * narrower audience's rule eventually leaks. If a vendor needs to see what they
 * sent, they have the original.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user.id) return json(401, "Sign in to view this.");

  if (!(await can("vendor.view_documents"))) {
    return json(403, "You don't have permission to view vendor documents.");
  }

  const { documentId } = await context.params;
  const parsed = objectIdSchema.safeParse(documentId);
  if (!parsed.success) return json(404, "No such document.");

  const document = await findDocument(parsed.data);
  if (!document) return json(404, "No such document.");

  // Purged means the object should no longer exist. Say so rather than issuing a
  // signed URL that will 404 at the bucket and read as a broken page.
  if (document.purgedAt) {
    return json(410, "That document was removed after the verification decision.");
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  const userAgent = requestHeaders.get("user-agent");

  await writeAuditLog({
    action: "vendor_document.viewed",
    actor: staffActor({
      id: session.user.id,
      ...(session.user.name ? { name: session.user.name } : {}),
    }),
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
