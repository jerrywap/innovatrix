import { Schema, type Types } from "mongoose";
import { MoneySchema, ORG_SCOPE_FIELD, referenceField, schemaOptions } from "../base";
import { defineModel } from "../client";
import {
  AI_CONTEXT_TYPES,
  AI_CONVERSATION_STATUSES,
  AI_MESSAGE_ROLES,
  FOLLOW_UP_STATUSES,
  REQUEST_KINDS,
  REQUEST_STATUSES,
  REQUIREMENT_ORIGINS,
  STAFF_ROLES,
  SUBJECT_TYPES,
  type AiContextType,
  type AiConversationStatus,
  type FollowUpStatus,
  type RequestKind,
  type RequestStatus,
  type SubjectType,
} from "../enums";

/**
 * Requirements & requests — §16–20 (customisation), §21–25 (custom build),
 * §34 (requirements management), §39 (follow-ups), §72 (AI persistence),
 * §91 (state machine), §101 (never lose context).
 *
 * The distinction this file exists to protect is §17/§34: what the **customer
 * confirmed** and what the **AI assumed** are different things, and staff may
 * read both but rewrite neither. They are separate arrays with separate
 * ownership, not one list with a flag someone can flip.
 */

/* ────────────────────────────────────────────── AiConversation */

const aiMessageSchema = new Schema(
  {
    role: { type: String, enum: AI_MESSAGE_ROLES, required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    /** Per-turn cost accounting (ticket 16). */
    model: String,
    promptTokens: Number,
    completionTokens: Number,
    costMicros: Number,
  },
  { _id: false },
);

const requirementSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, required: true },
    detail: String,
    // §17: an assumption never silently becomes a requirement.
    origin: { type: String, enum: REQUIREMENT_ORIGINS, required: true },
    acceptedByCustomer: { type: Boolean, default: false },
  },
  { _id: false },
);

export interface AiConversationDoc {
  _id: Types.ObjectId;
  organizationId?: Types.ObjectId;
  userId?: Types.ObjectId;
  /** Set before sign-in so an anonymous conversation survives sign-up (ticket 17). */
  anonymousKey?: string;
  contextType: AiContextType;
  productId?: Types.ObjectId;
  productVersionId?: Types.ObjectId;
  productVersionNumber?: string;
  messages: unknown[];
  structuredAnswers: Record<string, unknown>;
  requirements: unknown[];
  summary?: string;
  recommendedProductIds: Types.ObjectId[];
  recommendationChoice?: "existing_product" | "custom_build";
  status: AiConversationStatus;
  promptVersion?: string;
  submittedRequestId?: Types.ObjectId;
  totalCostMicros: number;
}

const aiConversationSchema = new Schema<AiConversationDoc>(
  {
    [ORG_SCOPE_FIELD]: { type: Schema.Types.ObjectId, ref: "Organization", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    anonymousKey: { type: String, index: true },

    contextType: { type: String, enum: AI_CONTEXT_TYPES, required: true },
    // §20/§101 — a customisation keeps an explicit link to the base product AND
    // the exact version, so staff never receive "customer wants CRM".
    productId: { type: Schema.Types.ObjectId, ref: "Product" },
    productVersionId: { type: Schema.Types.ObjectId, ref: "ProductVersion" },
    productVersionNumber: String,

    // §19: the full transcript stays available to authorised staff. It is
    // evidence of what was agreed, so it is never trimmed or summarised away.
    messages: { type: [aiMessageSchema], default: [] },
    structuredAnswers: { type: Schema.Types.Mixed, default: {} },
    requirements: { type: [requirementSchema], default: [] },
    summary: String,

    // §24 — what we offered instead of a custom build, and what they chose.
    recommendedProductIds: { type: [Schema.Types.ObjectId], ref: "Product", default: [] },
    recommendationChoice: { type: String, enum: ["existing_product", "custom_build"] },

    status: { type: String, enum: AI_CONVERSATION_STATUSES, default: "active", index: true },
    promptVersion: String,
    submittedRequestId: { type: Schema.Types.ObjectId, ref: "CustomerRequest" },
    totalCostMicros: { type: Number, default: 0 },
  },
  schemaOptions({ collection: "aiConversations" }),
);

aiConversationSchema.index({ organizationId: 1, updatedAt: -1 });

export const AiConversation = defineModel<AiConversationDoc>(
  "AiConversation",
  aiConversationSchema,
);

/* ────────────────────────────────────────────── CustomerRequest */

const assignmentSchema = new Schema(
  {
    staffUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    role: { type: String, enum: STAFF_ROLES },
    assignedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    assignedAt: { type: Date, default: () => new Date() },
    unassignedAt: Date,
    note: String,
  },
  { _id: false },
);

const attachmentSchema = new Schema(
  {
    storageKey: { type: String, required: true },
    filename: { type: String, required: true },
    contentType: String,
    sizeBytes: Number,
    uploadedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    uploadedAt: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

export interface CustomerRequestDoc {
  _id: Types.ObjectId;
  reference: string;
  kind: RequestKind;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  title: string;
  aiConversationId?: Types.ObjectId;
  baseProductId?: Types.ObjectId;
  baseProductVersionId?: Types.ObjectId;
  baseProductVersionNumber?: string;
  customerRequirements: unknown[];
  assumptions: unknown[];
  requirementsVersion: number;
  requirementsHistory: unknown[];
  internalInterpretation?: string;
  attachments: unknown[];
  status: RequestStatus;
  assignments: unknown[];
  currentAssigneeUserId?: Types.ObjectId;
  quoteIds: Types.ObjectId[];
  budgetRange?: { min?: number; max?: number; currency?: string };
  desiredTimeline?: string;
  submittedAt?: Date;
  waitingOn?: "customer" | "innovatrix";
}

const customerRequestSchema = new Schema<CustomerRequestDoc>(
  {
    reference: referenceField,
    kind: { type: String, enum: REQUEST_KINDS, required: true, index: true },
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    title: { type: String, required: true },

    aiConversationId: { type: Schema.Types.ObjectId, ref: "AiConversation" },
    baseProductId: { type: Schema.Types.ObjectId, ref: "Product" },
    baseProductVersionId: { type: Schema.Types.ObjectId, ref: "ProductVersion" },
    baseProductVersionNumber: String,

    /**
     * §34: "Customer-confirmed requirements should not be silently changed by
     * staff." Only the customer edits this array; staff use
     * `internalInterpretation`. Enforced in RequestService, and reviewers
     * should treat any staff-side write to this field as a defect.
     */
    customerRequirements: { type: [requirementSchema], default: [] },
    assumptions: { type: [requirementSchema], default: [] },
    requirementsVersion: { type: Number, default: 1 },
    requirementsHistory: {
      type: [
        new Schema(
          {
            version: Number,
            requirements: { type: Schema.Types.Mixed },
            changedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
            changedAt: { type: Date, default: () => new Date() },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    internalInterpretation: String,
    attachments: { type: [attachmentSchema], default: [] },

    status: {
      type: String,
      enum: REQUEST_STATUSES,
      required: true,
      default: "draft",
      index: true,
    },
    assignments: { type: [assignmentSchema], default: [] },
    currentAssigneeUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    quoteIds: { type: [Schema.Types.ObjectId], ref: "Quote", default: [] },

    budgetRange: { min: Number, max: Number, currency: String },
    desiredTimeline: String,
    submittedAt: Date,
    /** Drives the §32 "Waiting for Customer" / "Awaiting Staff" queues. */
    waitingOn: { type: String, enum: ["customer", "innovatrix"] },
  },
  schemaOptions({ collection: "customerRequests" }),
);

customerRequestSchema.index({ organizationId: 1, createdAt: -1 });
// The §31/§32 staff queues. Without this they collection-scan at ~10k requests.
customerRequestSchema.index({ status: 1, currentAssigneeUserId: 1, updatedAt: -1 });
customerRequestSchema.index({ status: 1, kind: 1, createdAt: 1 });
customerRequestSchema.index({ waitingOn: 1, updatedAt: 1 });

export const CustomerRequest = defineModel<CustomerRequestDoc>(
  "CustomerRequest",
  customerRequestSchema,
);

/* ────────────────────────────────────────────── FollowUp */

export interface FollowUpDoc {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  ownerUserId: Types.ObjectId;
  subjectType: SubjectType;
  subjectId: Types.ObjectId;
  dueAt: Date;
  note: string;
  status: FollowUpStatus;
  completedAt?: Date;
}

const followUpSchema = new Schema<FollowUpDoc>(
  {
    [ORG_SCOPE_FIELD]: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    ownerUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subjectType: { type: String, enum: SUBJECT_TYPES, required: true },
    subjectId: { type: Schema.Types.ObjectId, required: true },
    dueAt: { type: Date, required: true },
    note: { type: String, required: true },
    status: { type: String, enum: FOLLOW_UP_STATUSES, default: "open" },
    completedAt: Date,
  },
  schemaOptions({ collection: "followUps" }),
);

// §39: "Overdue follow-ups should appear prominently" — this is the index that
// makes that query cheap enough to run on every staff page load.
followUpSchema.index({ ownerUserId: 1, status: 1, dueAt: 1 });
followUpSchema.index({ status: 1, dueAt: 1 });

export const FollowUp = defineModel<FollowUpDoc>("FollowUp", followUpSchema);

export { MoneySchema };
