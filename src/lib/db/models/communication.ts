import { Schema, type Types } from "mongoose";
import { ORG_SCOPE_FIELD, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  ACTOR_TYPES,
  CONVERSATION_SUBJECT_TYPES,
  DOMAIN_EVENTS,
  MESSAGE_SENDER_TYPES,
  MESSAGE_VISIBILITIES,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  SUBJECT_TYPES,
  type ActorType,
  type ConversationSubjectType,
  type DomainEventType,
  type MessageSenderType,
  type MessageVisibility,
  type NotificationCategory,
  type NotificationChannel,
  type SubjectType,
} from "../enums";

/**
 * Communication & cross-cutting — §37 (visibility), §38 (unified conversation
 * model), §69 (notifications), §70 (activity timeline), §90 (audit).
 *
 * `activityEvents` and `auditLogs` look similar and are deliberately separate:
 * activity is the customer-facing narrative ("Quote issued"), audit is the
 * compliance record ("user X changed Y from A to B at time T from IP Z").
 * Merging them means either leaking internal detail to customers or losing
 * detail the auditor needs.
 */

/* ────────────────────────────────────────────── Conversation */

export interface ConversationDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  subjectType: ConversationSubjectType;
  subjectId: Types.ObjectId;
  participantUserIds: Types.ObjectId[];
  lastMessageAt?: Date;
  lastCustomerMessageAt?: Date;
  lastStaffMessageAt?: Date;
}

const conversationSchema = new Schema<ConversationDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    subjectType: { type: String, enum: CONVERSATION_SUBJECT_TYPES, required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    participantUserIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
    lastMessageAt: Date,
    // These two feed the §31 "Awaiting Staff Response" / "Waiting for Customer"
    // counters without scanning messages.
    lastCustomerMessageAt: Date,
    lastStaffMessageAt: Date,
  },
  schemaOptions({ collection: "conversations" }),
);

// One conversation per subject in the MVP (§38).
conversationSchema.index({ subjectType: 1, subjectId: 1 }, { unique: true });

export const Conversation = defineModel<ConversationDoc>("Conversation", conversationSchema);

/* ────────────────────────────────────────────── Message */

/**
 * A file on a message.
 *
 * The key, and never a URL. Same rule as request attachments and payment
 * evidence: the bucket serves any known key unsigned, so anything addressable
 * is world-readable. Read through a participant-checked route.
 */
export interface MessageAttachment {
  storageKey: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
}

export interface MessageDoc {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  organizationId: Types.ObjectId;
  senderType: MessageSenderType;
  senderUserId?: Types.ObjectId;
  body: string;
  attachments: MessageAttachment[];
  visibility: MessageVisibility;
  readByUserIds: Types.ObjectId[];
}

const messageSchema = new Schema<MessageDoc>(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    senderType: { type: String, enum: MESSAGE_SENDER_TYPES, required: true },
    senderUserId: { type: Schema.Types.ObjectId, ref: "User" },
    body: { type: String, required: true },
    attachments: {
      type: [
        new Schema(
          {
            storageKey: { type: String, required: true },
            filename: String,
            contentType: String,
            sizeBytes: Number,
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    /**
     * §37: "Internal messages must never be exposed to customers."
     *
     * Defaulting to `internal` is deliberate. A code path that forgets to set
     * visibility hides a message from the customer — annoying but safe. The
     * reverse default would leak staff deliberation, which is not recoverable.
     * The customer-facing repository filters on this in the query itself
     * (ticket 21), not in application code afterwards.
     */
    visibility: {
      type: String,
      enum: MESSAGE_VISIBILITIES,
      required: true,
      default: "internal",
    },
    readByUserIds: { type: [Schema.Types.ObjectId], ref: "User", default: [] },
  },
  schemaOptions({ collection: "messages" }),
);

messageSchema.index({ conversationId: 1, visibility: 1, createdAt: 1 });

export const Message = defineModel<MessageDoc>("Message", messageSchema);

/* ────────────────────────────────────────────── Notification */

export interface NotificationDoc {
  _id: Types.ObjectId;
  recipientUserId: Types.ObjectId;
  organizationId?: Types.ObjectId;
  type: DomainEventType | string;
  /** Which preference bucket this belongs to (§69). */
  category: NotificationCategory;
  /**
   * One event, one notification, per recipient — the "no duplicates on retry"
   * criterion. A unique index on this is what makes a re-emitted event a
   * no-op rather than a second bell.
   */
  dedupeKey: string;
  title: string;
  body?: string;
  subjectType?: SubjectType;
  subjectId?: Types.ObjectId;
  href?: string;
  channels: string[];
  readAt?: Date;
  emailSentAt?: Date;
}

const notificationSchema = new Schema<NotificationDoc>(
  {
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    [ORG_SCOPE_FIELD]: { type: Schema.Types.ObjectId, ref: "Organization" },
    type: { type: String, required: true },
    category: { type: String, enum: NOTIFICATION_CATEGORIES, required: true },
    dedupeKey: { type: String, required: true },
    title: { type: String, required: true },
    body: String,
    subjectType: { type: String, enum: SUBJECT_TYPES },
    subjectId: { type: Schema.Types.ObjectId },
    // Every notification links straight to the record it concerns (§69).
    href: String,
    channels: { type: [String], enum: NOTIFICATION_CHANNELS, default: ["in_app"] },
    readAt: Date,
    emailSentAt: Date,
  },
  schemaOptions({ collection: "notifications" }),
);

// Backs the unread badge without scanning the collection.
notificationSchema.index({ recipientUserId: 1, readAt: 1, createdAt: -1 });
/*
 * The duplicate guard, enforced by the database rather than by a read-then-
 * write. Two concurrent deliveries of the same event both find nothing and
 * both insert otherwise; here the second one gets E11000 and the service
 * treats that as "already delivered".
 */
notificationSchema.index({ recipientUserId: 1, dedupeKey: 1 }, { unique: true });

export const Notification = defineModel<NotificationDoc>("Notification", notificationSchema);

/* ────────────────────────────────────────────── ActivityEvent */

export interface ActivityEventDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  subjectType: SubjectType;
  subjectId: Types.ObjectId;
  type: DomainEventType | string;
  /** Plain language, customer-readable (§70). */
  message: string;
  actorType: ActorType;
  actorUserId?: Types.ObjectId;
  actorName?: string;
  /** §70 timelines are split: customers never see internal deliberation. */
  visibility: MessageVisibility;
  payload?: Record<string, unknown>;
}

const activityEventSchema = new Schema<ActivityEventDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    subjectType: { type: String, enum: SUBJECT_TYPES, required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    type: { type: String, required: true },
    message: { type: String, required: true },
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User" },
    actorName: String,
    visibility: { type: String, enum: MESSAGE_VISIBILITIES, default: "customer" },
    payload: { type: Schema.Types.Mixed },
  },
  // Written only by the event bus (ticket 19), never by UI code. Immutable.
  schemaOptions({ collection: "activityEvents" }),
);

activityEventSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });
// Powers the §33 Customer 360 unified timeline.
activityEventSchema.index({ organizationId: 1, createdAt: -1 });

export const ActivityEvent = defineModel<ActivityEventDoc>(
  "ActivityEvent",
  activityEventSchema,
);

/* ────────────────────────────────────────────── AuditLog */

export interface AuditLogDoc {
  _id: Types.ObjectId;
  action: string;
  actorType: ActorType;
  actorUserId?: Types.ObjectId;
  organizationId?: Types.ObjectId;
  /**
   * Set when the actor acted *as* a vendor (vendor ticket 01).
   *
   * A scope column beside `organizationId`, and for the same reason: "everything
   * this vendor's people did" is a question staff will ask during a dispute, and
   * without the column it needs a join through every product they own. The
   * person is still `actorUserId`; this is the capacity they were in.
   */
  vendorId?: Types.ObjectId;
  subjectType?: SubjectType;
  subjectId?: Types.ObjectId;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
  /** "webhook:stripe", "reconciliation", "manual:<staffId>" — how it happened. */
  source?: string;
}

const auditLogSchema = new Schema<AuditLogDoc>(
  {
    action: { type: String, required: true, index: true },
    actorType: { type: String, enum: ACTOR_TYPES, required: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User" },
    [ORG_SCOPE_FIELD]: { type: Schema.Types.ObjectId, ref: "Organization", index: true },
    vendorId: { type: Schema.Types.ObjectId, ref: "Vendor", index: true },
    subjectType: { type: String, enum: SUBJECT_TYPES },
    subjectId: { type: Schema.Types.ObjectId },
    before: { type: Schema.Types.Mixed },
    after: { type: Schema.Types.Mixed },
    ip: String,
    userAgent: String,
    source: String,
  },
  // §90: append-only. The repository refuses update and delete; ticket 26
  // makes that a tested guarantee rather than a convention.
  schemaOptions({ collection: "auditLogs" }),
);

auditLogSchema.index({ subjectType: 1, subjectId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

/**
 * Append-only, enforced on the model rather than only on the repository — §90.
 *
 * `AuditLogRepository` overrides `updateById` and `deleteById` to throw, which
 * is the right thing and is not sufficient: **`AuditLog.updateOne(...)` never
 * touches the repository.** Any service that imports the model directly — as
 * several do, for perfectly good reasons — has an unguarded path to amending
 * the record of what happened, which is the single thing this collection exists
 * to make impossible.
 *
 * These hooks close it. Every query-level mutation and every save of an
 * existing document refuses; `create` and a first `save` are untouched, because
 * appending is the whole point.
 *
 * The remaining way through is the **native driver**
 * (`connection.db.collection("auditLogs")`), which bypasses Mongoose middleware
 * by design. That is deliberate rather than an oversight: it is what a test
 * teardown and a retention job legitimately need, and it is not something a
 * service reaches for by accident.
 */
const APPEND_ONLY =
  "The audit log is append-only (§90). An entry cannot be amended or removed — " +
  "record a new one describing the correction instead.";

function refuse(): never {
  throw new Error(APPEND_ONLY);
}

/*
 * Written out rather than looped.
 *
 * Mongoose types each hook name as its own overload, so a loop over a string
 * union needs an `any` cast — and a cast in the middle of a security control is
 * the wrong economy. Eight lines, no cast, and a name that does not compile if
 * Mongoose renames a hook.
 */
auditLogSchema.pre("updateOne", refuse);
auditLogSchema.pre("updateMany", refuse);
auditLogSchema.pre("replaceOne", refuse);
auditLogSchema.pre("findOneAndUpdate", refuse);
auditLogSchema.pre("findOneAndReplace", refuse);
auditLogSchema.pre("findOneAndDelete", refuse);
auditLogSchema.pre("deleteOne", refuse);
auditLogSchema.pre("deleteMany", refuse);

auditLogSchema.pre("save", function refuseAmendment() {
  // A brand-new document is an append. Anything else is an edit.
  if (!this.isNew) throw new Error(APPEND_ONLY);
});

export const AuditLog = defineModel<AuditLogDoc>("AuditLog", auditLogSchema);

export { DOMAIN_EVENTS };

/* ────────────────────────────────────────────── NotificationPreference */

/**
 * Per-user, per-category, per-channel — §69.
 *
 * ## Absent means on
 *
 * A row exists only once somebody has changed something. The alternative —
 * seeding a full preference document per user — means every new category ships
 * with a migration, and a user created before it was added silently never hears
 * about it. So the stored shape is the *exceptions*, and the default lives in
 * code where it can be read.
 *
 * Essential notifications ignore this document entirely (see
 * `ESSENTIAL_CATEGORIES`). A payment receipt or a licence key is not marketing.
 */
export interface NotificationPreferenceDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** `${category}:${channel}` → false. Only the off switches are stored. */
  muted: string[];
}

const notificationPreferenceSchema = new Schema<NotificationPreferenceDoc>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    muted: { type: [String], default: [] },
  },
  schemaOptions({ collection: "notificationPreferences" }),
);

export const NotificationPreference = defineModel<NotificationPreferenceDoc>(
  "NotificationPreference",
  notificationPreferenceSchema,
);

/** The stored key for one switch. Built in one place so it cannot drift. */
export function mutedKey(category: NotificationCategory, channel: NotificationChannel): string {
  return `${category}:${channel}`;
}
