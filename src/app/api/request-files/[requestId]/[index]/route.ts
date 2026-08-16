import { getSession, can } from "@/lib/auth/dal";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { CustomerRequest, type CustomerRequestDoc } from "@/lib/db/models/requests";
import { objectIdSchema } from "@/validators/common";
import { createDownloadUrl } from "@/services/storage";

/**
 * `GET /api/request-files/[requestId]/[index]` — an attachment, briefly.
 *
 * ## Two audiences, one gate
 *
 * The customer who owns the request, and staff who may read requests. Both go
 * through here rather than through an address, because the bucket serves any
 * known key unsigned and these are customer documents — a spec, a price list, a
 * spreadsheet of staff names.
 *
 * ## The index is the handle, and it is bounds-checked
 *
 * Attachments are embedded and have no `_id`. Exposing the storage key as a
 * handle would defeat the point of the route, so the array position is used —
 * which means a caller can send `999` or `-1`, and both must land as a plain
 * 404 rather than reading `undefined.storageKey`.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ requestId: string; index: string }> },
): Promise<Response> {
  const session = await getSession();
  // Before the ids are looked at, so a malformed one and a real one give an
  // anonymous caller the same answer.
  if (!session?.user.id) return json(401, "Sign in to view this.");

  const { requestId, index } = await context.params;

  const id = objectIdSchema.safeParse(requestId);
  const position = Number(index);
  if (!id.success || !Number.isInteger(position) || position < 0) {
    return json(404, "No such file.");
  }

  await connectToDatabase();
  const request = await CustomerRequest.findById(
    toObjectId(id.data),
  ).lean<CustomerRequestDoc>();
  if (!request) return json(404, "No such file.");

  const isOwner =
    Boolean(session.activeOrganizationId) &&
    String(request.organizationId) === session.activeOrganizationId;

  if (!isOwner && !(await can("request.view_all"))) {
    // Same answer as "no such request" — whether a request id is real is not
    // something a stranger gets to confirm.
    return json(404, "No such file.");
  }

  const attachment = request.attachments?.[position];
  if (!attachment?.storageKey) return json(404, "No such file.");

  const { url } = await createDownloadUrl({
    key: attachment.storageKey,
    filename: attachment.filename,
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
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
