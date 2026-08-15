import { Schema, type Types } from "mongoose";
import { ORG_SCOPE_FIELD, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  ACTOR_TYPES,
  CONVERSATION_SUBJECT_TYPES,
  DOMAIN_EVENTS,
  MESSAGE_SENDER_TYPES,
  MESSAGE_VISIBILITIES,
  NOTIFICATION_CHANNELS,
  SUBJECT_TYPES,
  type ActorType,
  type ConversationSubjectType,
  type DomainEventType,
  type MessageSenderType,
  type MessageVisibility,
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

export interface MessageDoc {
  _id: Types.ObjectId;
  conversationId: Types.ObjectId;
  organizationId: Types.ObjectId;
  senderType: MessageSenderType;
  senderUserId?: Types.ObjectId;
  body: string;
  attachments: unknown[];
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

export const AuditLog = defineModel<AuditLogDoc>("AuditLog", auditLogSchema);

export { DOMAIN_EVENTS };
