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

/**
 * One turn of the transcript.
 *
 * `withheld` is §73 made durable: when the guardrail check catches an assistant
 * turn quoting a price or promising a date, the customer is shown a safe reply
 * and **the original is kept here** rather than discarded. Staff reviewing what
 * the assistant actually said need the real text; deleting it would hide the
 * failure the check exists to catch.
 */
export interface AiMessage {
  role: (typeof AI_MESSAGE_ROLES)[number];
  content: string;
  at: Date;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  costMicros?: number;
  /** The unedited text, when `content` is a guardrail substitution. */
  withheldContent?: string;
  withheldReason?: string;
}

const aiMessageSchema = new Schema<AiMessage>(
  {
    role: { type: String, enum: AI_MESSAGE_ROLES, required: true },
    content: { type: String, required: true },
    at: { type: Date, default: () => new Date() },
    /** Per-turn cost accounting (ticket 16). */
    model: String,
    promptTokens: Number,
    completionTokens: Number,
    costMicros: Number,
    withheldContent: String,
    withheldReason: String,
  },
  { _id: false },
);

/**
 * One line of what the customer wants.
 *
 * `origin` is the §17 distinction and the reason this is not a plain string
 * array: `confirmed` is something the customer said yes to, `assumed` is the
 * model filling a gap, `suggested` is an offer they have not answered. A
 * suggestion that quietly becomes a requirement is the specific failure §23
 * names, and keeping the three apart in the schema is what makes it hard.
 */
export interface Requirement {
  key: string;
  label: string;
  detail?: string;
  origin: (typeof REQUIREMENT_ORIGINS)[number];
  acceptedByCustomer: boolean;
}

const requirementSchema = new Schema<Requirement>(
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
  messages: AiMessage[];
  structuredAnswers: Record<string, unknown>;
  requirements: Requirement[];
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

/**
 * §40 — assignment is a log, not a pointer.
 *
 * A row is closed with `unassignedAt` rather than removed, so "who had this
 * before, and who moved it" survives reassignment. `currentAssigneeUserId` on
 * the request is the denormalised head of this list, kept only because the
 * staff-queue index needs a single field to sort on.
 */
export interface Assignment {
  staffUserId: Types.ObjectId;
  role?: (typeof STAFF_ROLES)[number];
  assignedByUserId?: Types.ObjectId;
  assignedAt: Date;
  unassignedAt?: Date;
  note?: string;
}

const assignmentSchema = new Schema<Assignment>(
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

export interface RequestAttachment {
  storageKey: string;
  filename: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedByUserId?: Types.ObjectId;
  uploadedAt: Date;
}

const attachmentSchema = new Schema<RequestAttachment>(
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

/**
 * §34 — a requirements edit keeps the version it replaced.
 *
 * Staff who want a change ask the customer, who edits and re-confirms. That is
 * only auditable if the previous text survives, so each edit pushes the *old*
 * array here before overwriting.
 */
export interface RequirementsRevision {
  version: number;
  requirements: Requirement[];
  changedByUserId?: Types.ObjectId;
  changedAt: Date;
}

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
  customerRequirements: Requirement[];
  assumptions: Requirement[];
  requirementsVersion: number;
  requirementsHistory: RequirementsRevision[];
  internalInterpretation?: string;
  attachments: RequestAttachment[];
  status: RequestStatus;
  assignments: Assignment[];
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
        new Schema<RequirementsRevision>(
          {
            version: { type: Number, required: true },
            requirements: { type: [requirementSchema], default: [] },
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

/**
 * The "unassigned" queue, which is the staff nav's default landing place.
 *
 * The index above has `updatedAt` last, so a query filtering on status and
 * assignee but sorting by **`createdAt`** cannot use it for the sort — measured
 * with `npm run db:explain:queues`: an in-memory SORT examining 5,000 documents
 * to return 100, 84ms at ten thousand rows and linear from there.
 *
 * `createdAt` rather than `updatedAt` is the right sort for this one on
 * purpose. "Nobody has picked this up" is about how long it has been *waiting*,
 * and `updatedAt` moves every time anything touches the row, which would keep
 * resetting the age of the thing most at risk.
 */
customerRequestSchema.index({ status: 1, currentAssigneeUserId: 1, createdAt: 1 });

export const CustomerRequest = defineModel<CustomerRequestDoc>(
  "CustomerRequest",
  customerRequestSchema,
);

/* ────────────────────────────────────────────── AiSettings */

/**
 * Which model the assistants use — §104, ticket 16.
 *
 * ## Why this is a row and not just an env var
 *
 * §104's requirement is that the platform keeps working when a provider
 * misbehaves. Doing that from `OPENROUTER_MODEL` alone means a redeploy at the
 * exact moment something is on fire. A row means an administrator switches
 * model or reorders the fallbacks in the admin screen, and the next request
 * uses it.
 *
 * ## The key is not here, and must never be
 *
 * Same rule as `PaymentSettings` (§88): the database holds *which* model, never
 * the credential to call it. `OPENROUTER_API_KEY` stays in the environment and
 * the settings screen reports only whether it is present. A settings row is
 * readable by every administrator and ends up in backups and exports; an API
 * key belongs in neither.
 *
 * Resolution is `AiSettings` → `OPENROUTER_MODEL` → the built-in default, so an
 * empty database still boots and still talks.
 */
export interface AiSettingsDoc {
  _id: Types.ObjectId;
  singleton: "global";
  /** Off ⇒ every assistant degrades to the manual form, deliberately. */
  enabled: boolean;
  /** `vendor/model` as OpenRouter names it. */
  model: string;
  /**
   * Tried in order when the primary errors — OpenRouter's own `models` array.
   * This is the §104 failover, and it is why a single vendor outage is not an
   * outage here.
   */
  fallbackModels: string[];
  /**
   * Extraction may warrant a stronger model than the interview: one is a
   * conversation, the other decides what a customer is deemed to have asked
   * for. Empty ⇒ use `model` for both.
   */
  extractionModel?: string;
  temperature: number;
  maxOutputTokens: number;
  updatedByUserId?: Types.ObjectId;
}

const aiSettingsSchema = new Schema<AiSettingsDoc>(
  {
    singleton: { type: String, default: "global", enum: ["global"] },
    enabled: { type: Boolean, default: true },
    model: { type: String, required: true },
    fallbackModels: { type: [String], default: [] },
    extractionModel: String,
    // Low, not zero. An interview that asks the same question the same way
    // every time reads as a form with extra steps, which is what §15 is trying
    // to get away from.
    temperature: { type: Number, default: 0.4, min: 0, max: 2 },
    maxOutputTokens: { type: Number, default: 1200, min: 128, max: 32_000 },
    updatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  schemaOptions({ collection: "aiSettings" }),
);

aiSettingsSchema.index({ singleton: 1 }, { unique: true });

export const AiSettings = defineModel<AiSettingsDoc>("AiSettings", aiSettingsSchema);

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
