import "server-only";
import { z } from "zod";
import type { AiContextType } from "@/lib/db/enums";
import type { AiMessage, Requirement } from "@/lib/db/models/requests";
import { extractStructured, ExtractionFailedError } from "./extract";
import type { ResolvedAiConfig } from "./settings";

/**
 * The §18 / §25 summary — a conversation turned into something reviewable.
 *
 * ## `origin` is extracted, not inferred later
 *
 * §17 and §23 both hinge on the same distinction: what the customer **agreed
 * to**, what the assistant **assumed**, and what was **offered and not
 * answered**. Deciding that after the fact — by keyword, or by "everything in
 * the summary is confirmed" — is how a suggestion becomes a requirement and
 * then becomes a quote. So the model is asked for it per line, the enum is in
 * the schema, and the Zod parse rejects anything else.
 *
 * ## This is the moment AI output becomes customer-confirmed
 *
 * Nothing here is authoritative. It is a draft the customer edits and accepts;
 * §18's "every line editable" is what turns it into `customerRequirements`.
 * Until they press submit, it is still the assistant's opinion.
 */

const requirementLine = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(60)
    .transform((value) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 60),
    ),
  label: z.string().trim().min(1).max(200),
  detail: z.string().trim().max(600).optional(),
  origin: z.enum(["confirmed", "assumed", "suggested"]),
});

export const summarySchema = z.object({
  /** One line, used as the request title. */
  title: z.string().trim().min(3).max(140),
  businessContext: z.string().trim().max(1200).optional(),
  requirements: z.array(requirementLine).min(1).max(60),
  integrations: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  deploymentNotes: z.string().trim().max(600).optional(),
  /** Only what the customer said. The assistant may not invent one (§73). */
  timeline: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1200).optional(),
});

export type RequirementsSummary = z.infer<typeof summarySchema>;

/**
 * The same shape as JSON Schema, for the model.
 *
 * Hand-written rather than generated from the Zod schema: `strict: true`
 * requires every property listed in `required` and `additionalProperties:
 * false` throughout, and the generators disagree on how to express optionals
 * under that constraint. Kept adjacent so the two are edited together — the
 * Zod parse is what catches it if they ever drift.
 */
const SUMMARY_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "businessContext",
    "requirements",
    "integrations",
    "deploymentNotes",
    "timeline",
    "notes",
  ],
  properties: {
    title: { type: "string", description: "A short name for this request." },
    businessContext: {
      type: "string",
      description: "What the business does. Empty if unclear.",
    },
    requirements: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "detail", "origin"],
        properties: {
          key: { type: "string", description: "A short slug, lowercase, hyphenated." },
          label: { type: "string", description: "One line, in the customer's words." },
          detail: { type: "string", description: "Any specifics they gave. Empty if none." },
          origin: {
            type: "string",
            enum: ["confirmed", "assumed", "suggested"],
            description:
              "confirmed = the customer explicitly agreed to it. assumed = you inferred it " +
              "and they did not say it. suggested = you offered it and they did not answer. " +
              "Never mark something confirmed that the customer did not say.",
          },
        },
      },
    },
    integrations: { type: "array", items: { type: "string" } },
    deploymentNotes: { type: "string" },
    timeline: {
      type: "string",
      description: "Only a date or timeframe the CUSTOMER stated. Empty otherwise.",
    },
    notes: { type: "string" },
  },
};

const SYSTEM = `
You are turning a requirements interview into a structured summary a human will
review and quote.

Rules that matter more than completeness:
- **Never invent a requirement.** If it was not discussed, it is not in the list.
  A short accurate summary beats a full plausible one — every line here may be
  built and billed.
- Use the customer's own words for each label. Do not translate their business
  language into technical language.
- \`origin\` is the most important field. Mark \`confirmed\` **only** where the
  customer explicitly agreed. Anything you worked out yourself is \`assumed\`.
  Anything you offered that they did not accept is \`suggested\`.
- **Include the things they declined or deferred**, marked \`suggested\`. "Not
  sure, leave it for now" and "maybe one day" are useful: they tell the reviewer
  what was considered and what the customer is thinking about next. Dropping
  them loses that. Just never mark them \`confirmed\`.
- Put no price, cost, rate or delivery estimate anywhere. \`timeline\` carries a
  date the customer stated and nothing else.
`.trim();

export interface SummaryResult {
  summary: RequirementsSummary;
  /** Split ready for `submitFromConversation`. */
  confirmed: Requirement[];
  assumptions: Requirement[];
  costMicros: number;
  strategy: string;
}

export async function summariseConversation(input: {
  config: ResolvedAiConfig;
  contextType: AiContextType;
  messages: readonly AiMessage[];
  productName?: string;
}): Promise<SummaryResult> {
  const transcript = input.messages
    .filter((message) => message.role !== "system")
    .map(
      (message) => `${message.role === "user" ? "Customer" : "Assistant"}: ${message.content}`,
    )
    .join("\n\n");

  const preface =
    input.contextType === "customization" && input.productName
      ? `The customer is asking for changes to an existing product called ` +
        `"${input.productName}". Requirements are changes to it, not the whole system.\n\n`
      : "";

  const result = await extractStructured({
    config: input.config,
    schema: summarySchema,
    jsonSchema: SUMMARY_JSON_SCHEMA,
    schemaName: "requirements_summary",
    system: SYSTEM,
    input: `${preface}Transcript:\n\n${transcript}`,
  });

  return {
    summary: result.data,
    ...split(result.data.requirements),
    costMicros: result.usage.costMicros,
    strategy: result.strategy,
  };
}

/**
 * Confirmed on one side; assumed *and* suggested on the other.
 *
 * §23: "suggestions never silently become requirements". Grouping suggested
 * with assumed rather than with confirmed is that rule expressed in the split —
 * both are things the customer has not said yes to, and both need their assent
 * before they count.
 */
function split(lines: RequirementsSummary["requirements"]): {
  confirmed: Requirement[];
  assumptions: Requirement[];
} {
  const confirmed: Requirement[] = [];
  const assumptions: Requirement[] = [];

  for (const line of lines) {
    const requirement: Requirement = {
      key: line.key,
      label: line.label,
      ...(line.detail ? { detail: line.detail } : {}),
      origin: line.origin,
      acceptedByCustomer: line.origin === "confirmed",
    };
    (line.origin === "confirmed" ? confirmed : assumptions).push(requirement);
  }

  return { confirmed, assumptions };
}

export { ExtractionFailedError };
