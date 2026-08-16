import { headers } from "next/headers";
import { getSession, requireOrgOrNull } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { toObjectId } from "@/lib/db/base";
import { Download } from "@/lib/db/models/commerce";
import { ForbiddenError } from "@/lib/errors";
import { LIMITS, consume, tooManyRequests } from "@/lib/rate-limit";
import { objectIdSchema } from "@/validators/common";
import { authoriseDownload } from "@/services/entitlements/entitlement-service";
import { downloadUrlFor } from "@/services/catalog/file-service";
import { writeAuditLog } from "@/services/audit";

/**
 * A protected download — §66.
 *
 * ## Bytes never pass through this server
 *
 * The response is a **307 to a five-minute presigned URL**. Streaming a 2GB
 * package through Next would hold a serverless invocation open for the whole
 * transfer, and proxying it buys nothing: the object store is better at serving
 * files than we are.
 *
 * ## Nor is a permanent URL ever returned
 *
 * The presigned URL expires. A link that does not is a licence given away the
 * first time somebody pastes it into a forum, and §66 is explicit about it.
 *
 * ## Every download is recorded before the redirect
 *
 * Not after — a redirect we do not survive would leave no trace of a file that
 * was served. The row is the customer-facing audit (§66) and staff read it on
 * Customer 360.
 *
 * ## Refusals are deliberately uniform
 *
 * A file that does not exist and a file belonging to somebody else's product
 * both answer 403 with the same body. Distinguishing them turns this endpoint
 * into an oracle for which file ids are real.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
): Promise<Response> {
  /*
   * Authenticate **first**, then validate the input.
   *
   * The other order looks harmless and is not: a malformed id answered 403
   * while a well-formed one answered 401, so an anonymous caller could tell
   * the two apart from outside. That is a small signal, but it is one an
   * unauthenticated stranger has no business getting, and the fix is free.
   */
  const session = await getSession();
  if (!session) {
    // 401 rather than 403: unauthenticated is recoverable by signing in, and
    // the client can act on the difference.
    return json({ error: "Sign in to download this." }, 401);
  }

  const { fileId: raw } = await context.params;
  const parsed = objectIdSchema.safeParse(raw);
  if (!parsed.success) return refuse();

  const org = await requireOrgOrNull();
  if (!org) {
    return json({ error: "Choose an organisation to download on behalf of." }, 403);
  }

  let authorised;
  try {
    authorised = await authoriseDownload(parsed.data, org.organizationId);
  } catch (error) {
    if (error instanceof ForbiddenError) {
      // The *reason* is safe to show — it is about their own entitlement, not
      // about whether the file exists. "Your update window ended" is
      // actionable; "forbidden" is not.
      return json({ error: error.message }, 403);
    }
    // No `NotFoundError` branch: `authoriseDownload` refuses a missing file,
    // a missing version and an unentitled caller identically, so that the
    // endpoint cannot be used to test whether a file id is real. Anything else
    // reaching here is a genuine fault and should surface as a 500.
    throw error;
  }

  /*
   * §88's per-day download cap, applied per organisation.
   *
   * Not a security control — `authoriseDownload` above is. This is what stops a
   * leaked session, or a script pointed at a valid account, from pulling the
   * whole catalogue at object-store egress rates. Keyed on the organisation
   * rather than the user, because the licence belongs to the organisation and
   * five logins should not mean five budgets.
   *
   * **After** authorisation, so only downloads a caller was actually entitled
   * to spend the budget. Counting refusals would let anyone with a session
   * exhaust their own organisation's allowance by guessing at file ids.
   */
  const budget = await consume(LIMITS.download, org.organizationId);
  if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

  const requestHeaders = await headers();

  await connectToDatabase();
  await Download.create({
    organizationId: toObjectId(org.organizationId),
    entitlementId: authorised.entitlement._id,
    productFileId: authorised.file._id,
    userId: toObjectId(session.user.id),
    ...(clientIp(requestHeaders) ? { ip: clientIp(requestHeaders)! } : {}),
    ...(requestHeaders.get("user-agent")
      ? { userAgent: requestHeaders.get("user-agent")!.slice(0, 400) }
      : {}),
  });

  await writeAuditLog({
    action: "download.served",
    actor: { type: "customer", userId: session.user.id, organizationId: org.organizationId },
    subject: { type: "entitlement", id: String(authorised.entitlement._id) },
    organizationId: org.organizationId,
    after: {
      filename: authorised.file.filename,
      version: authorised.version.version,
      sizeBytes: authorised.file.sizeBytes,
    },
    ...(clientIp(requestHeaders) ? { ip: clientIp(requestHeaders)! } : {}),
  });

  const { url } = await downloadUrlFor(String(authorised.file._id), {
    // Five minutes: long enough to start a 2GB download, short enough that a
    // leaked URL is worthless by the time it is shared.
    expiresInSeconds: 300,
  });

  return Response.redirect(url, 307);
}

function refuse(): Response {
  // Same answer for "no such file" and "not yours". Anything else is a
  // membership oracle for the file-id space.
  return json({ error: "You don't have a licence for this product." }, 403);
}

function clientIp(requestHeaders: Headers): string | undefined {
  const forwarded = requestHeaders.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim();
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
