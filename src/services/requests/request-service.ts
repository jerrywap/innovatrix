import "server-only";
import type { ClientSession, Types } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { counterStore } from "@/lib/db/counter-store";
import type { RequestKind, RequestStatus } from "@/lib/db/enums";
import { Product } from "@/lib/db/models/catalog";
import { ActivityEvent } from "@/lib/db/models/communication";
import {
  AiConversation,
  CustomerRequest,
  type CustomerRequestDoc,
  type Requirement,
} from "@/lib/db/models/requests";
import {
  assertTransition,
  nextStates,
  REQUEST_TRANSITIONS,
  requestTransitionRule,
} from "@/lib/db/states";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { generateReference } from "@/lib/references";
import { withTransaction } from "@/lib/db/transaction";
import { emit } from "@/lib/events";
import { staffActor, writeAuditLog, type AuditActor } from "@/services/audit";
import { orgFilter } from "@/lib/auth/scope";

/**
 * Requests — §91 (state machine), §92 (events), §34 (requirements), §101.
 *
 * ## `transition()` is the only way a status changes
 *
 * Not a convention — the reason. §91 requires server-side validation, and a
 * service that also allows `{ $set: { status } }` somewhere else has the
 * validation *and* a way round it. Every status write in the codebase goes
 * through here, and a reviewer should treat any other one as a defect.
 *
 * Each transition does four things atomically and one thing after:
 *
 *   1. validate the edge against `REQUEST_TRANSITIONS`
 *   2. validate the *actor* against `REQUEST_TRANSITION_RULES`
 *   3. write the activity event (§70)
 *   4. write the audit entry (§90)
 *   — commit —
 *   5. emit the domain event (§92)
 *
 * Five is deliberately outside. A notification handler failing must not
 * un-move a request that has moved.
 */

/* ────────────────────────────────────────────── actors */

export type RequestActor =
  | { type: "customer"; userId: string; organizationId: string; name?: string }
  /**
   * `permissions` is a `ReadonlySet` because that is what `requireStaff()`
   * returns and because `.has()` is the operation every check performs. An
   * array here would mean every call site converting, and `includes` on a
   * 45-element array on every transition.
   */
  | { type: "staff"; userId: string; name?: string; permissions: ReadonlySet<string> }
  | { type: "system" };

function auditActorFor(actor: RequestActor): AuditActor {
  if (actor.type === "staff") {
    return staffActor({ id: actor.userId, ...(actor.name ? { name: actor.name } : {}) });
  }
  if (actor.type === "customer") {
    return {
      type: "customer",
      userId: actor.userId,
      organizationId: actor.organizationId,
      ...(actor.name ? { name: actor.name } : {}),
    };
  }
  return { type: "system" };
}

/* ────────────────────────────────────────────── reads */

export async function findByReference(
  reference: string,
  scope: { organizationId?: string },
): Promise<CustomerRequestDoc | null> {
  await connectToDatabase();

  return CustomerRequest.findOne({
    reference,
    // Staff pass no organisation and see across all of them (§30); a customer
    // always passes theirs, and the filter is what stops the id being a key to
    // somebody else's request. A blank string is neither, and throws.
    ...orgFilter(scope),
  }).lean<CustomerRequestDoc>();
}

/** The moves this actor may make from here — drives the staff action buttons. */
export function permittedTransitions(
  from: RequestStatus,
  actor: RequestActor,
): { to: RequestStatus; label: string }[] {
  return nextStates(REQUEST_TRANSITIONS, from)
    .map((to) => ({ to, rule: requestTransitionRule(from, to) }))
    .filter(({ rule }) => {
      if (!rule) return false;
      if (actor.type === "system") return true;
      if (actor.type === "customer") return rule.customerMay;
      return rule.permission !== null && actor.permissions.has(rule.permission);
    })
    .map(({ to, rule }) => ({ to, label: rule!.label }));
}

/* ────────────────────────────────────────────── transition */

export interface TransitionInput {
  requestId: string;
  to: RequestStatus;
  actor: RequestActor;
  /** Shown on the customer timeline when the move is customer-visible. */
  note?: string;
  /** Internal-only detail; never rendered to a customer (§37). */
  internalNote?: string;
}

export async function transition(input: TransitionInput): Promise<CustomerRequestDoc> {
  await connectToDatabase();

  const before = await CustomerRequest.findById(
    toObjectId(input.requestId),
  ).lean<CustomerRequestDoc>();
  if (!before) throw new NotFoundError("request", { id: input.requestId });

  // Throws StateTransitionError. Checked before authorisation so an impossible
  // move reads as impossible rather than as "you lack permission", which would
  // send somebody looking for a role that would let them do it.
  assertTransition("request", REQUEST_TRANSITIONS, before.status, input.to);

  const rule = requestTransitionRule(before.status, input.to)!;
  assertActorMay(rule, input.actor, before);

  const updated = await withTransaction(async (session) => {
    /*
     * Guarded on the status we read. Two staff clicking "Start review" together
     * would otherwise both pass validation and both write an activity row for a
     * transition that happened once.
     */
    const result = await CustomerRequest.findOneAndUpdate(
      { _id: before._id, status: before.status },
      {
        $set: {
          status: input.to,
          ...waitingOnFor(input.to),
          ...(input.to === "submitted" ? { submittedAt: new Date() } : {}),
        },
      },
      { returnDocument: "after", session },
    ).lean<CustomerRequestDoc>();

    if (!result) {
      throw new ValidationError("That request has already moved on.", {
        status: ["Someone else changed this request. Reload and try again."],
      });
    }

    await ActivityEvent.create(
      [
        {
          organizationId: result.organizationId,
          subjectType: "request",
          subjectId: result._id,
          type: "RequestStatusChanged",
          message: input.note ?? customerNarrative(input.to, result.reference),
          actorType: input.actor.type,
          ...(input.actor.type !== "system"
            ? { actorUserId: toObjectId(input.actor.userId) }
            : {}),
          ...(input.actor.type !== "system" && input.actor.name
            ? { actorName: input.actor.name }
            : {}),
          visibility: "customer",
        },
      ],
      { session },
    );

    if (input.internalNote) {
      // §37: a second row, internal-only. Never merged into the one above —
      // one field controlling two audiences is how deliberation leaks.
      await ActivityEvent.create(
        [
          {
            organizationId: result.organizationId,
            subjectType: "request",
            subjectId: result._id,
            type: "RequestStatusChanged",
            message: input.internalNote,
            actorType: input.actor.type,
            ...(input.actor.type !== "system"
              ? { actorUserId: toObjectId(input.actor.userId) }
              : {}),
            visibility: "internal",
          },
        ],
        { session },
      );
    }

    await writeAuditLog(
      {
        action: "request.status_changed",
        actor: auditActorFor(input.actor),
        subject: { type: "request", id: String(result._id) },
        organizationId: String(result.organizationId),
        before: { status: before.status },
        after: { status: input.to },
      },
      session,
    );

    return result;
  });

  // Outside the transaction, and never allowed to undo it.
  await emit("RequestStatusChanged", {
    requestId: String(updated._id),
    reference: updated.reference,
    organizationId: String(updated.organizationId),
    from: before.status,
    to: input.to,
    actorType: input.actor.type,
    ...(input.actor.type !== "system" ? { actorId: input.actor.userId } : {}),
  });

  if (input.to === "waiting_for_customer") {
    await emit("CustomerActionRequested", {
      requestId: String(updated._id),
      reference: updated.reference,
      organizationId: String(updated.organizationId),
      ...(input.note ? { note: input.note } : {}),
    });
  }

  return updated;
}

function assertActorMay(
  rule: { permission: string | null; customerMay: boolean },
  actor: RequestActor,
  request: CustomerRequestDoc,
): void {
  if (actor.type === "system") return;

  if (actor.type === "customer") {
    if (!rule.customerMay) {
      throw new ForbiddenError("That isn't something you can do to this request.");
    }
    if (String(request.organizationId) !== actor.organizationId) {
      // Scope, not permission: the request belongs to someone else.
      throw new NotFoundError("request", { id: String(request._id) });
    }
    return;
  }

  if (rule.permission === null || !actor.permissions.has(rule.permission)) {
    throw new ForbiddenError("You don't have permission to make that change.");
  }
}

/** Drives the §32 "waiting for" queues, so it is derived rather than set by hand. */
function waitingOnFor(status: RequestStatus): { waitingOn?: "customer" | "innovatrix" } {
  if (status === "waiting_for_customer") return { waitingOn: "customer" };
  if (status === "submitted" || status === "under_review" || status === "technical_review") {
    return { waitingOn: "innovatrix" };
  }
  return {};
}

/**
 * §70 — plain language, and written for the customer.
 *
 * Not the status name. "technical_review" is our vocabulary; "with our
 * technical team" is theirs, and the timeline is something they read.
 */
function customerNarrative(status: RequestStatus, reference: string): string {
  switch (status) {
    case "submitted":
      return `Request ${reference} submitted`;
    case "under_review":
      return "We're reviewing your request";
    case "waiting_for_customer":
      return "We've asked you a question";
    case "technical_review":
      return "With our technical team";
    case "quoted":
      return "We've sent you a quote";
    case "approved":
      return "You accepted the quote";
    case "converted":
      return "Work has started";
    case "rejected":
      return "We couldn't take this one on";
    case "cancelled":
      return "Request cancelled";
    default:
      return "Request updated";
  }
}

/* ────────────────────────────────────────────── submission */

export interface SubmitInput {
  conversationId: string;
  kind: RequestKind;
  title: string;
  organizationId: string;
  userId: string;
  userName?: string;
  /** What the customer confirmed. Immutable to staff afterwards (§34). */
  customerRequirements: Requirement[];
  /** What the AI inferred or offered. Kept separate, forever (§17). */
  assumptions: Requirement[];
  baseProductId?: string;
  baseProductVersionId?: string;
  baseProductVersionNumber?: string;
  desiredTimeline?: string;
  /** The customer's free-text "anything else". Context, never a requirement. */
  customerNotes?: string;
  budgetRange?: { min?: number; max?: number; currency?: string };
}

/**
 * Turn a finished conversation into a request — §19, §25.
 *
 * One transaction, and the reference generator **joins it**. A rolled-back
 * submission that had already taken `CUS-2026-0007` would leave a permanent gap
 * in a sequence people read as complete; `counterStore(session)` is what stops
 * that, and it is the same fix ticket 11 needed for orders.
 */
export async function submitFromConversation(input: SubmitInput): Promise<CustomerRequestDoc> {
  await connectToDatabase();

  const prefix = input.kind === "customization" ? "CUS" : "REQ";

  /*
   * Whose software is this about — vendor ticket 14.
   *
   * Resolved here and nowhere else, because this is the one moment the answer is knowable and
   * fixed: the product may change hands later, and the request was still asked of whoever was
   * selling it. Absent for a first-party product and for every `custom_build`, which has no base
   * product to own.
   *
   * Read **outside** the transaction on purpose. It is a single indexed read of a public catalogue
   * row, nothing in the transaction depends on its freshness, and holding a session open across it
   * would lengthen the transaction for no gain.
   *
   * This does **not** notify the vendor. Staff triage first (decision W3), so routing is a separate
   * deliberate act — see `brief-service.routeToVendor`.
   */
  const vendorId: Types.ObjectId | undefined = input.baseProductId
    ? ((
        await Product.findById(toObjectId(input.baseProductId))
          .select({ vendorId: 1 })
          .lean<{ vendorId?: Types.ObjectId }>()
      )?.vendorId ?? undefined)
    : undefined;

  const request = await withTransaction(async (session) => {
    const existing = await AiConversation.findById(toObjectId(input.conversationId))
      .session(session)
      .lean<{ submittedRequestId?: unknown; status: string }>();

    if (!existing) throw new NotFoundError("conversation", { id: input.conversationId });

    if (existing.submittedRequestId) {
      // Double-submit — a second tab, or a retried action. Return what exists
      // rather than minting a second request for one conversation.
      const already = await CustomerRequest.findById(existing.submittedRequestId)
        .session(session)
        .lean<CustomerRequestDoc>();
      if (already) return already;
    }

    const reference = await generateReference(counterStore(session), prefix);

    const [created] = await CustomerRequest.create(
      [
        {
          reference,
          kind: input.kind,
          organizationId: toObjectId(input.organizationId),
          userId: toObjectId(input.userId),
          title: input.title,
          aiConversationId: toObjectId(input.conversationId),
          ...(input.baseProductId ? { baseProductId: toObjectId(input.baseProductId) } : {}),
          ...(input.baseProductVersionId
            ? { baseProductVersionId: toObjectId(input.baseProductVersionId) }
            : {}),
          ...(input.baseProductVersionNumber
            ? { baseProductVersionNumber: input.baseProductVersionNumber }
            : {}),
          ...(vendorId ? { vendorId } : {}),
          customerRequirements: input.customerRequirements,
          assumptions: input.assumptions,
          requirementsVersion: 1,
          requirementsHistory: [],
          status: "submitted",
          submittedAt: new Date(),
          waitingOn: "innovatrix",
          ...(input.desiredTimeline ? { desiredTimeline: input.desiredTimeline } : {}),
          ...(input.customerNotes ? { customerNotes: input.customerNotes } : {}),
          ...(input.budgetRange ? { budgetRange: input.budgetRange } : {}),
        },
      ],
      { session },
    );

    await AiConversation.updateOne(
      { _id: toObjectId(input.conversationId) },
      { $set: { status: "submitted", submittedRequestId: created!._id } },
      { session },
    );

    await ActivityEvent.create(
      [
        {
          organizationId: created!.organizationId,
          subjectType: "request",
          subjectId: created!._id,
          type: input.kind === "customization" ? "CustomizationSubmitted" : "RequestSubmitted",
          message: `Request ${reference} submitted`,
          actorType: "customer",
          actorUserId: toObjectId(input.userId),
          ...(input.userName ? { actorName: input.userName } : {}),
          visibility: "customer",
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: "request.submitted",
        actor: auditActorFor({
          type: "customer",
          userId: input.userId,
          organizationId: input.organizationId,
          ...(input.userName ? { name: input.userName } : {}),
        }),
        subject: { type: "request", id: String(created!._id) },
        organizationId: input.organizationId,
        after: { reference, kind: input.kind, status: "submitted" },
      },
      session,
    );

    return created!.toObject() as CustomerRequestDoc;
  });

  await emit(input.kind === "customization" ? "CustomizationSubmitted" : "RequestSubmitted", {
    requestId: String(request._id),
    reference: request.reference,
    organizationId: String(request.organizationId),
    ...(input.kind === "customization"
      ? { ...(input.baseProductId ? { productId: input.baseProductId } : {}) }
      : { kind: input.kind }),
  } as never);

  return request;
}

/* ────────────────────────────────────────────── requirements (§34) */

/**
 * The customer edits their own requirements. **Staff cannot.**
 *
 * §34: "Customer-confirmed requirements should not be silently changed by
 * staff." The acceptance criterion goes further — impossible through the API,
 * not merely absent from the UI — so this function refuses a staff actor
 * outright rather than relying on no screen offering it.
 *
 * Staff who need a change use `internalInterpretation`, or ask the customer.
 */
export async function reviseRequirements(input: {
  requestId: string;
  actor: RequestActor;
  requirements: Requirement[];
}): Promise<CustomerRequestDoc> {
  if (input.actor.type !== "customer") {
    throw new ForbiddenError(
      "Only the customer can change confirmed requirements. Ask them to update the request, " +
        "or record your reading in the internal interpretation.",
    );
  }

  // Bound before the transaction closure: TypeScript drops the narrowing of
  // `input.actor` across a callback boundary, and re-asserting it inside with a
  // cast would be discarding the check rather than keeping it.
  const actor = input.actor;

  await connectToDatabase();

  const before = await CustomerRequest.findById(
    toObjectId(input.requestId),
  ).lean<CustomerRequestDoc>();
  if (!before) throw new NotFoundError("request", { id: input.requestId });

  if (String(before.organizationId) !== actor.organizationId) {
    throw new NotFoundError("request", { id: input.requestId });
  }

  /*
   * Only while we are waiting on them, or before we have started. Editing the
   * scope of something already quoted would silently invalidate the quote.
   */
  if (!["draft", "submitted", "waiting_for_customer"].includes(before.status)) {
    throw new ForbiddenError(
      "This request is being worked on. Send us a message and we'll update it with you.",
    );
  }

  const updated = await withTransaction(async (session) => {
    const result = await CustomerRequest.findOneAndUpdate(
      { _id: before._id, requirementsVersion: before.requirementsVersion },
      {
        $set: {
          customerRequirements: input.requirements,
          requirementsVersion: before.requirementsVersion + 1,
        },
        // The version being replaced, not the new one — history is what was,
        // and pushing the new one would record the present twice.
        $push: {
          requirementsHistory: {
            version: before.requirementsVersion,
            requirements: before.customerRequirements,
            changedByUserId: toObjectId(actor.userId),
            changedAt: new Date(),
          },
        },
      },
      { returnDocument: "after", session },
    ).lean<CustomerRequestDoc>();

    if (!result) {
      throw new ValidationError("Those requirements changed while you were editing.", {
        requirements: ["Reload and try again."],
      });
    }

    await ActivityEvent.create(
      [
        {
          organizationId: result.organizationId,
          subjectType: "request",
          subjectId: result._id,
          type: "RequirementsRevised",
          message: "You updated what you need",
          actorType: "customer",
          actorUserId: toObjectId(actor.userId),
          visibility: "customer",
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: "request.requirements_revised",
        actor: auditActorFor(actor),
        subject: { type: "request", id: String(result._id) },
        organizationId: String(result.organizationId),
        before: { version: before.requirementsVersion },
        after: { version: result.requirementsVersion },
      },
      session,
    );

    return result;
  });

  await emit("RequirementsRevised", {
    requestId: String(updated._id),
    reference: updated.reference,
    organizationId: String(updated.organizationId),
    version: updated.requirementsVersion,
  });

  return updated;
}

/**
 * A progress update — a customer-visible timeline entry with no state change.
 *
 * ## Why this did not exist, and what it cost
 *
 * `transition()` was the **only** writer of a `visibility: "customer"` activity
 * row. So a customer could be told something only when their request moved
 * between states — and once it reached `converted`, which happens automatically
 * the moment the deposit clears, there were no states left. The last thing they
 * ever heard was "Payment received", and weeks of work produced silence.
 *
 * Most progress is not a state change. "The tenant portal is done, reporting is
 * next" moves nothing; it is the entire substance of being kept informed (§70).
 *
 * ## Two rows, never one field
 *
 * The internal note is a second `ActivityEvent`, exactly as `transition()` does
 * it. §37 is a disclosure boundary and one field controlling two audiences is
 * how deliberation leaks — a filter that is wrong once shows staff wording to
 * the customer, whereas a row that was never written cannot be.
 *
 * ## Permission
 *
 * `request.update_status`: whoever may move the work along may say what is
 * happening to it. Posting an update is strictly less powerful than a
 * transition, so it needs no permission of its own.
 */
export async function postProgressUpdate(input: {
  requestId: string;
  actor: Extract<RequestActor, { type: "staff" }>;
  /** Shown to the customer. Required — an empty update is not an update. */
  message: string;
  /** Staff-only, optional, written as its own row. */
  internalNote?: string;
}): Promise<void> {
  if (!input.actor.permissions.has("request.update_status")) {
    throw new ForbiddenError("You don't have permission to post updates.");
  }

  const message = input.message.trim();
  if (message.length === 0) {
    throw new ValidationError("An update needs something in it.", {
      message: ["Say what has happened."],
    });
  }

  await connectToDatabase();

  const request = await CustomerRequest.findById(
    toObjectId(input.requestId),
  ).lean<CustomerRequestDoc>();
  if (!request) throw new NotFoundError("request", { id: input.requestId });

  await ActivityEvent.create({
    organizationId: request.organizationId,
    subjectType: "request",
    subjectId: request._id,
    type: "RequestProgressPosted",
    message,
    actorType: "staff",
    actorUserId: toObjectId(input.actor.userId),
    ...(input.actor.name ? { actorName: input.actor.name } : {}),
    visibility: "customer",
  });

  if (input.internalNote?.trim()) {
    await ActivityEvent.create({
      organizationId: request.organizationId,
      subjectType: "request",
      subjectId: request._id,
      type: "RequestProgressPosted",
      message: input.internalNote.trim(),
      actorType: "staff",
      actorUserId: toObjectId(input.actor.userId),
      visibility: "internal",
    });
  }

  await writeAuditLog({
    action: "request.progress_posted",
    actor: auditActorFor(input.actor),
    subject: { type: "request", id: input.requestId },
    organizationId: String(request.organizationId),
    after: { message },
  });

  // The customer is told. This is the whole point — an update nobody is
  // notified about is a note in a file.
  await emit("RequestProgressPosted", {
    requestId: String(request._id),
    reference: request.reference,
    organizationId: String(request.organizationId),
    message,
  });
}

/** Staff-owned reading of the request. Never shown to the customer (§34). */
export async function setInternalInterpretation(input: {
  requestId: string;
  actor: Extract<RequestActor, { type: "staff" }>;
  text: string;
}): Promise<void> {
  if (!input.actor.permissions.has("request.comment_internal")) {
    throw new ForbiddenError("You don't have permission to add internal notes.");
  }

  await connectToDatabase();
  const updated = await CustomerRequest.findByIdAndUpdate(
    toObjectId(input.requestId),
    { $set: { internalInterpretation: input.text } },
    { returnDocument: "after" },
  ).lean<CustomerRequestDoc>();

  if (!updated) throw new NotFoundError("request", { id: input.requestId });

  await writeAuditLog({
    action: "request.interpretation_updated",
    actor: auditActorFor(input.actor),
    subject: { type: "request", id: input.requestId },
    organizationId: String(updated.organizationId),
  });
}

/* ────────────────────────────────────────────── assignment (§40) */

export async function assign(input: {
  requestId: string;
  actor: Extract<RequestActor, { type: "staff" }>;
  assigneeUserId: string;
  note?: string;
}): Promise<CustomerRequestDoc> {
  if (!input.actor.permissions.has("request.assign")) {
    throw new ForbiddenError("You don't have permission to assign requests.");
  }

  await connectToDatabase();

  const updated = await withTransaction(async (session: ClientSession) => {
    // Close the open assignment rather than replacing the array: §40 wants the
    // history, including who reassigned and when.
    await CustomerRequest.updateOne(
      { _id: toObjectId(input.requestId) },
      { $set: { "assignments.$[open].unassignedAt": new Date() } },
      { arrayFilters: [{ "open.unassignedAt": { $exists: false } }], session },
    );

    const result = await CustomerRequest.findByIdAndUpdate(
      toObjectId(input.requestId),
      {
        $set: { currentAssigneeUserId: toObjectId(input.assigneeUserId) },
        $push: {
          assignments: {
            staffUserId: toObjectId(input.assigneeUserId),
            assignedByUserId: toObjectId(input.actor.userId),
            assignedAt: new Date(),
            ...(input.note ? { note: input.note } : {}),
          },
        },
      },
      { returnDocument: "after", session },
    ).lean<CustomerRequestDoc>();

    if (!result) throw new NotFoundError("request", { id: input.requestId });

    // Internal only. Who is working on a request is our business, not a
    // customer-facing narrative beat.
    await ActivityEvent.create(
      [
        {
          organizationId: result.organizationId,
          subjectType: "request",
          subjectId: result._id,
          type: "RequestAssigned",
          message: input.note ?? "Assigned",
          actorType: "staff",
          actorUserId: toObjectId(input.actor.userId),
          ...(input.actor.name ? { actorName: input.actor.name } : {}),
          visibility: "internal",
        },
      ],
      { session },
    );

    await writeAuditLog(
      {
        action: "request.assigned",
        actor: auditActorFor(input.actor),
        subject: { type: "request", id: input.requestId },
        organizationId: String(result.organizationId),
        after: { assigneeUserId: input.assigneeUserId },
      },
      session,
    );

    return result;
  });

  await emit("RequestAssigned", {
    requestId: String(updated._id),
    reference: updated.reference,
    organizationId: String(updated.organizationId),
    assigneeUserId: input.assigneeUserId,
    assignedByUserId: input.actor.userId,
  });

  return updated;
}
