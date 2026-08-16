import "server-only";
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
  assumptions: Requirement[];
  requirementsVersion: number;
  /** Only while the request is still theirs to change. */
  canEditRequirements: boolean;

  /** §20/§101 — what this is a customisation *of*. */
  baseProduct?: { id: string; slug: string; name: string; version?: string };

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

/**
 * §70 in the customer's words, and — the part that matters — *what happens
 * next*. A status alone leaves them guessing whether it is their move.
 */
const STATUS_COPY: Record<RequestStatus, { what: string; next: string }> = {
  draft: {
    what: "You haven't sent this to us yet.",
    next: "Finish it whenever you're ready.",
  },
  submitted: {
    what: "We've got it.",
    next: "Someone will pick it up and read it properly. Nothing needed from you.",
  },
  under_review: {
    what: "Someone is going through it.",
    next: "We'll come back with questions or a quote.",
  },
  waiting_for_customer: {
    what: "We've asked you something.",
    next: "Have a look below — we can't go further until you answer.",
  },
  technical_review: {
    what: "Our technical team is scoping it.",
    next: "They're working out what it takes. A quote follows.",
  },
  quoted: {
    what: "We've sent you a quote.",
    next: "Have a read and let us know either way.",
  },
  approved: {
    what: "You accepted the quote.",
    next: "We'll get the work scheduled and be in touch.",
  },
  converted: {
    what: "Work has started.",
    next: "You'll hear from whoever is building it.",
  },
  rejected: {
    what: "We couldn't take this one on.",
    next: "Get in touch if you'd like to talk about it.",
  },
  cancelled: {
    what: "This was cancelled.",
    next: "Start a new request whenever you need to.",
  },
};

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
    createdAt: isoDay((row as unknown as { createdAt: Date }).createdAt),
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
          .select({ slug: 1, name: 1 })
          .lean<{ _id: unknown; slug: string; name: string }>()
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
    statusExplanation: STATUS_COPY[request.status],
    ...(request.submittedAt ? { submittedAt: isoDay(request.submittedAt) } : {}),
    ...(request.waitingOn ? { waitingOn: request.waitingOn } : {}),

    customerRequirements: request.customerRequirements,
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
      uploadedAt: isoDay(attachment.uploadedAt),
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
      at: event.createdAt ? isoDay(event.createdAt) : "",
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
          ...(conversation ? { transcript: conversation.messages } : {}),
          organizationId: String(request.organizationId),
          ...(assignee?.name ? { assigneeName: assignee.name } : {}),
        }
      : {}),
  };
}

function isoDay(value: Date): string {
  return new Date(value).toISOString().slice(0, 10);
}
