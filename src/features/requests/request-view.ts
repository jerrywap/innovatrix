import "server-only";
import { REQUEST_STATUS_COPY } from "./status-copy";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import type { RequestStatus } from "@/lib/db/enums";
import { ActivityEvent } from "@/lib/db/models/communication";
import {
  AiConversation,
  CustomerRequest,
  type AiMessage,
  type CustomerRequestDoc,
  type Requirement,
} from "@/lib/db/models/requests";
import { Product } from "@/lib/db/models/catalog";
import { User } from "@/lib/db/models/identity";
import { formatDateTime } from "@/lib/dates";

/**
 * Reading a request — §70 (timeline), §101 (never lose context).
 *
 * ## Two audiences, one loader, and the difference is a parameter
 *
 * §37's rule is that a customer never sees internal deliberation. The tempting
 * shape is two loaders; the safer one is a single loader taking `audience`,
 * because two loaders drift and only one of them is ever the one somebody
 * remembers to update.
 *
 * `audience: "customer"` filters the timeline to `visibility: "customer"` and
 * **omits `internalInterpretation` entirely** — not blanked, absent, so it
 * cannot be rendered by accident from a field that happens to be there.
 */

export interface RequestTimelineEntry {
  id: string;
  message: string;
  /** ISO 8601. The component decides how it reads; this decides when it was. */
  at: string;
  actorName?: string;
  internal: boolean;
}

export interface RequestDetailView {
  id: string;
  reference: string;
  kind: "customization" | "custom_build";
  title: string;
  status: RequestStatus;
  statusExplanation: { what: string; next: string };
  submittedAt?: string;
  waitingOn?: "customer" | "innovatrix";

  customerRequirements: Requirement[];
  /**
   * The customer's own "anything else", verbatim.
   *
   * Both audiences see it and neither may edit it. It is context rather than a
   * requirement — deliberately not folded into `customerRequirements`, because a
   * line in that array is a line that gets quoted and built.
   */
  customerNotes?: string;
  assumptions: Requirement[];
  requirementsVersion: number;
  /** Only while the request is still theirs to change. */
  canEditRequirements: boolean;

  /** §20/§101 — what this is a customisation *of*. */
  baseProduct?: { id: string; slug: string; name: string; version?: string };
  /** Staff-only — vendor ticket 14. Whose software this is about, when it is not ours. */
  vendorName?: string;

  /**
   * Files on the request — a mockup, a spec, a spreadsheet.
   *
   * The storage key is **not** here. Both audiences read these through
   * `/api/request-files/[requestId]/[index]`, which checks who is asking; the
   * bucket serves any known key unsigned, so an addressable URL would make a
   * customer's document world-readable.
   */
  attachments: Array<{
    index: number;
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    uploadedAt: string;
  }>;

  timeline: RequestTimelineEntry[];

  /* Staff only. Absent for a customer, not empty. */
  internalInterpretation?: string;
  transcript?: AiMessage[];
  organizationId?: string;
  assigneeName?: string;
}

/** Only while it is still the customer's to change (§34). */
const EDITABLE_IN: readonly RequestStatus[] = ["draft", "submitted", "waiting_for_customer"];

export interface ListedRequest {
  id: string;
  reference: string;
  kind: "customization" | "custom_build";
  title: string;
  status: RequestStatus;
  waitingOn?: "customer" | "innovatrix";
  createdAt: string;
  productName?: string;
}

export async function listRequestsForOrganization(
  organizationId: string,
  filter: { status?: RequestStatus } = {},
): Promise<ListedRequest[]> {
  await connectToDatabase();

  const rows = await CustomerRequest.find({
    organizationId: toObjectId(organizationId),
    // A draft is a conversation that has not been sent; it belongs on the
    // assistant page, not in a list of things we are working on.
    ...(filter.status ? { status: filter.status } : { status: { $ne: "draft" } }),
  })
    .sort({ createdAt: -1 })
    .limit(100)
    .lean<CustomerRequestDoc[]>();

  const productNames = await namesFor(rows);

  return rows.map((row) => ({
    id: String(row._id),
    reference: row.reference,
    kind: row.kind,
    title: row.title,
    status: row.status,
    ...(row.waitingOn ? { waitingOn: row.waitingOn } : {}),
    createdAt: formatDateTime((row as unknown as { createdAt: Date }).createdAt),
    ...(row.baseProductId && productNames.has(String(row.baseProductId))
      ? { productName: productNames.get(String(row.baseProductId))!.name }
      : {}),
  }));
}

async function namesFor(rows: readonly CustomerRequestDoc[]) {
  const ids = [
    ...new Set(
      rows
        .map((row) => row.baseProductId)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    ),
  ];
  if (ids.length === 0) return new Map<string, { slug: string; name: string }>();

  const products = await Product.find({ _id: { $in: ids } })
    .select({ slug: 1, name: 1 })
    .lean<{ _id: unknown; slug: string; name: string }[]>();

  return new Map(products.map((p) => [String(p._id), { slug: p.slug, name: p.name }]));
}

export async function loadRequest(
  reference: string,
  options: {
    audience: "customer" | "staff";
    /** Required for a customer; a staff reader sees across organisations (§30). */
    organizationId?: string;
  },
): Promise<RequestDetailView | null> {
  await connectToDatabase();

  const request = await CustomerRequest.findOne({
    reference,
    ...(options.organizationId ? { organizationId: toObjectId(options.organizationId) } : {}),
  }).lean<CustomerRequestDoc>();

  if (!request) return null;

  const isStaff = options.audience === "staff";

  const [product, events, conversation, assignee] = await Promise.all([
    request.baseProductId
      ? Product.findById(request.baseProductId)
          // `vendorName` for vendor ticket 14: the staff screen has to know whether there is a
          // vendor to send this to, and this loader was the only reason it could not.
          .select({ slug: 1, name: 1, vendorName: 1 })
          .lean<{ _id: unknown; slug: string; name: string; vendorName?: string }>()
      : null,

    ActivityEvent.find({
      subjectType: "request",
      subjectId: request._id,
      // The §37 filter, and the reason this loader takes an audience at all.
      ...(isStaff ? {} : { visibility: "customer" }),
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean<
        Array<{
          _id: unknown;
          message: string;
          actorName?: string;
          visibility: string;
          createdAt?: Date;
        }>
      >(),

    // §19/§101 — staff read the whole transcript as evidence of what was agreed.
    isStaff && request.aiConversationId
      ? AiConversation.findById(request.aiConversationId)
          .select({ messages: 1 })
          .lean<{ messages: AiMessage[] }>()
      : null,

    isStaff && request.currentAssigneeUserId
      ? User.findById(request.currentAssigneeUserId)
          .select({ name: 1 })
          .lean<{ name?: string }>()
      : null,
  ]);

  return {
    id: String(request._id),
    reference: request.reference,
    kind: request.kind,
    title: request.title,
    status: request.status,
    statusExplanation: REQUEST_STATUS_COPY[request.status],
    ...(request.submittedAt ? { submittedAt: formatDateTime(request.submittedAt) } : {}),
    ...(request.waitingOn ? { waitingOn: request.waitingOn } : {}),

    customerRequirements: request.customerRequirements,
    ...(request.customerNotes ? { customerNotes: request.customerNotes } : {}),
    assumptions: request.assumptions,
    requirementsVersion: request.requirementsVersion,
    canEditRequirements: EDITABLE_IN.includes(request.status),

    attachments: (request.attachments ?? []).map((attachment, index) => ({
      // The array position is the handle. Attachments are embedded and have no
      // `_id`, and exposing the storage key — the thing that would otherwise
      // serve as one — is precisely what must not happen.
      index,
      filename: attachment.filename,
      ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
      ...(attachment.sizeBytes ? { sizeBytes: attachment.sizeBytes } : {}),
      uploadedAt: formatDateTime(attachment.uploadedAt),
    })),

    ...(product
      ? {
          baseProduct: {
            id: String(product._id),
            slug: product.slug,
            name: product.name,
            ...(request.baseProductVersionNumber
              ? { version: request.baseProductVersionNumber }
              : {}),
          },
        }
      : {}),

    timeline: events.map((event) => ({
      id: String(event._id),
      message: event.message,
      // ISO, not a rendered string: `<Timeline>` sorts on it and wraps it in
      // `<time dateTime>`. Formatting here is what threw the time away before —
      // the view layer decided how it looked and the component never saw a date.
      at: event.createdAt ? new Date(event.createdAt).toISOString() : "",
      ...(event.actorName ? { actorName: event.actorName } : {}),
      internal: event.visibility !== "customer",
    })),

    /*
     * Staff-only fields, spread in rather than set to undefined. A customer's
     * view object does not have an `internalInterpretation` key at all, so it
     * cannot be rendered from one that happens to be present and empty — and
     * "no internal notes in a customer payload" becomes checkable by grepping
     * the serialised response rather than by reading every component.
     */
    ...(isStaff
      ? {
          ...(request.internalInterpretation
            ? { internalInterpretation: request.internalInterpretation }
            : {}),
          /*
           * Vendor ticket 14, and **staff-only on purpose**.
           *
           * A customer is not told which of the two possible parties is scoping their change. They
           * bought from a marketplace and the platform is answering them; who we ask internally is
           * ours. Spread in with the other staff fields so a customer's view object has no key for
           * it at all.
           */
          ...(product?.vendorName ? { vendorName: product.vendorName } : {}),
          ...(conversation ? { transcript: conversation.messages } : {}),
          organizationId: String(request.organizationId),
          ...(assignee?.name ? { assigneeName: assignee.name } : {}),
        }
      : {}),
  };
}
