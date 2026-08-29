import "server-only";
import { z } from "zod";
import { extractStructured, ExtractionFailedError } from "./extract";
import type { ResolvedAiConfig } from "./settings";

/**
 * Authoring help for the product wizard — enhance prose, propose features.
 *
 * ## Why this goes through `extractStructured`
 *
 * What we want back is a string, and there is no plain text-in/text-out helper
 * in this service. Adding one would mean a third call site for
 * `openRouter().chat.completions.create` and a third place to remember
 * `withCostAccounting`, `measureTurn` and `asAiError`.
 *
 * Wrapping the answer in a one-field object costs nothing and buys the thing
 * that actually matters here: the model **cannot reply in prose**. Asked for a
 * rewrite in free form, a model returns "Sure! Here's an improved version:"
 * about a third of the time, and that preamble would land in a vendor's product
 * page. A schema with one required string makes that unrepresentable.
 *
 * ## Nothing here is authoritative
 *
 * `summary.ts` says it and it is truer here: this is a draft the author reads
 * beside their own version and accepts, edits or throws away. The comparison
 * modal is the control, not this function.
 *
 * ## Why `PROMPT_VERSION` is not bumped for these
 *
 * That constant lives in `prompts/index.ts` and is stamped onto every
 * *conversation* (`conversation-service.ts`), so it exists to make an
 * assistant's behaviour traceable to the wording that produced it. Nothing here
 * touches a conversation, and bumping it would mark every conversation as
 * having a new prompt when none of them did. `summary.ts` keeps its own system
 * prompt locally for the same reason; so do these.
 *
 * ## Why `guardrails.ts` is not applied
 *
 * §73's detector replaces a customer-facing answer wholesale when it finds a
 * price or a date. That is right for the assistant, which speaks to a customer
 * with nobody in between. It is wrong here: the author reads every word before
 * anything is kept, and a silent substitution in an authoring tool is baffling
 * rather than protective. The prompt carries the rule instead — and unlike the
 * assistant, a vendor naming their own product's price is legitimate.
 */

/* ────────────────────────────────────────────── enhance prose */

export const enhancedProseSchema = z.object({
  /**
   * Bounded well above the field's own limit deliberately.
   *
   * `productBasicsSchema` caps a summary at 300 characters, and a model asked
   * for one line sometimes returns two. Rejecting that here turns a fixable
   * result into an error the author cannot act on; letting it through puts it in
   * the editable pane where they can cut it, and the form's own validation still
   * refuses to save an over-long one.
   */
  text: z.string().trim().min(1).max(8000),
});

const ENHANCED_PROSE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: {
    text: {
      type: "string",
      description: "The rewritten text, and nothing else. No preamble, no commentary.",
    },
  },
};

/**
 * The rules, in the order they matter.
 *
 * "Do not invent" is first for `summary.ts`'s reason — this output goes on a
 * public product page that a customer makes a purchase decision from, so a
 * plausible capability the product does not have is worse than a dull sentence.
 */
const PROSE_RULES = `
You are helping a software vendor write the listing for their own product.

Rules that matter more than polish:
- **Never invent anything.** No feature, integration, price, date, customer
  count, award or guarantee that is not in what you were given. If the input is
  thin, write something short and true rather than something full and made up.
- Keep the author's meaning and their product's name exactly as written.
- Write for somebody deciding whether to buy. Lead with what it does for a
  business, not with how it was built.
- Plain British English. No marketing superlatives, no exclamation marks, no
  "revolutionary", "seamless", "cutting-edge" or "unlock".
- Return the rewritten text only. No preamble, no explanation, no quotes around
  it.
`.trim();

const SUMMARY_SYSTEM = `
${PROSE_RULES}

You are rewriting the **summary**: one sentence, under 300 characters, that
appears on every marketplace card. It has to work for somebody skimming a grid.
Return plain text — no HTML, no Markdown, no line breaks.
`.trim();

/**
 * The tag list is the editor's, not HTML's.
 *
 * `rich-text-editor.tsx` runs a deliberately narrow Tiptap schema, and anything
 * outside it is dropped when the reply is parsed back in — silently, because
 * that parse is also what makes the reply safe. Naming the permitted tags is the
 * difference between a model that formats within the schema and one whose
 * `<table>` disappears without explanation.
 */
const DESCRIPTION_SYSTEM = `
${PROSE_RULES}

You are rewriting the **description**: the longer text on the product page,
below the summary. A few short paragraphs, with a heading or a list where it
genuinely helps. Aim for 120–350 words.

Return **HTML**, using only these tags:
<p> <h2> <h3> <ul> <ol> <li> <blockquote> <pre> <code> <strong> <em> <s> <a> <br>

Any other tag is discarded, so do not use one. No <h1> — the page owns that
level. No <img>, no <table>, no attributes except href on <a>.
`.trim();

/**
 * Search results and shared links, where the limit *is* the brief.
 *
 * Google truncates a title around 60 characters and a description around 155,
 * and `productSeoSchema` refuses more than 70 and 160. So the count is stated
 * twice — once as the writing constraint and once as a hard stop — because a
 * model told only "be concise" reliably writes 200 characters of concise prose.
 *
 * Both fields fall back to the product's own name and summary when blank, which
 * the form's placeholders already promise. That makes "enhance" here mean
 * something specific: earn your place by being *better* than the fallback, or
 * the field should stay empty.
 */
const SEO_TITLE_SYSTEM = `
${PROSE_RULES}

You are writing the **search-result title** for this product's page.

- **Hard limit 70 characters.** Aim for 55–60, which is where Google truncates.
- Lead with the product name, then what it is: "Atlas CRM — property management
  software".
- No brand suffix, no "| CoSetup", no pipes or arrows for decoration.
- If the product's own name already reads perfectly as a title, say so by
  returning it unchanged rather than padding it.

Return plain text.
`.trim();

const SEO_DESCRIPTION_SYSTEM = `
${PROSE_RULES}

You are writing the **meta description** — the sentence under the link in search
results.

- **Hard limit 160 characters.** Aim for 140–155.
- One sentence. What it does and who it is for. No feature lists.
- Do not start with the product name; the title above it already carries that.
- No call to action, no "click here", no "discover".

Return plain text.
`.trim();

export interface EnhanceProseInput {
  config: ResolvedAiConfig;
  field: "summary" | "description" | "seoTitle" | "seoDescription";
  /** Plain text for everything except a description, which is HTML. */
  text: string;
  /** The rest of the form, so a rewrite knows what the product is. */
  context: { name?: string; summary?: string; description?: string };
}

/** Which prompt a field gets, and what to call it in the instruction. */
const FIELDS = {
  summary: { system: () => SUMMARY_SYSTEM, noun: "summary" },
  description: { system: () => DESCRIPTION_SYSTEM, noun: "description" },
  seoTitle: { system: () => SEO_TITLE_SYSTEM, noun: "search-result title" },
  seoDescription: { system: () => SEO_DESCRIPTION_SYSTEM, noun: "meta description" },
} as const;

export async function enhanceProse(
  input: EnhanceProseInput,
): Promise<{ text: string; costMicros: number }> {
  const { name, summary, description } = input.context;

  /*
   * The field being rewritten is named separately from the context, so the
   * model is not handed the same paragraph twice with no indication of which
   * one it is meant to return.
   */
  const field = FIELDS[input.field];

  const context = [
    name ? `Product name: ${name}` : null,
    input.field !== "summary" && summary ? `Summary: ${summary}` : null,
    input.field !== "description" && description ? `Description (HTML): ${description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const body = input.text.trim();

  const result = await extractStructured({
    config: input.config,
    schema: enhancedProseSchema,
    jsonSchema: ENHANCED_PROSE_JSON_SCHEMA,
    schemaName: "enhanced_prose",
    system: field.system(),
    /*
     * Not `0`. A rewrite that returns the identical sentence on a second press
     * reads as a button that did nothing — see the note in `extract.ts`.
     */
    temperature: input.config.temperature,
    input: [
      context ? `About the product:\n${context}` : null,
      body
        ? `Rewrite this ${field.noun}:\n\n${body}`
        : /*
           * An empty field is the common case, not an error: one of 1,010
           * published products has a description. "Enhance" on nothing is
           * "write a first draft from what you know", and saying so gets a
           * better result than sending an empty string and hoping.
           */
          `There is no ${field.noun} yet. Write a first one from what you know above.`,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  return { text: result.data.text, costMicros: result.usage.costMicros };
}

/* ────────────────────────────────────────────── propose features */

export const proposedFeaturesSchema = z.object({
  features: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(120),
        detail: z.string().trim().max(500).optional(),
      }),
    )
    .min(1)
    // `productContentSchema` allows 60; a proposal that long is a list nobody
    // reads, and trimming it here is kinder than making the author delete 50.
    .max(12),
});

const PROPOSED_FEATURES_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["features"],
  properties: {
    features: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "detail"],
        properties: {
          title: {
            type: "string",
            description:
              "One short line, in the imperative or as a noun phrase. Max 120 chars.",
          },
          detail: {
            type: "string",
            description:
              "One sentence of specifics, or an empty string if there is nothing true to add.",
          },
        },
      },
    },
  },
};

const FEATURES_SYSTEM = `
${PROSE_RULES}

You are proposing a **feature list** for the product page: short lines a buyer
scans to see whether it does what they need.

- 5 to 8 features. Fewer if the input does not support more.
- Each title is one line. Each detail is at most one sentence, and may be empty.
- Features, not benefits: "Role-based access", not "Peace of mind".
- Do not repeat the summary back as a feature.
- If the author already has features, keep the ones that are right — rewriting
  a good line into a worse one is the failure to avoid here.
`.trim();

export interface ProposeFeaturesInput {
  config: ResolvedAiConfig;
  product: {
    name: string;
    summary: string;
    /** HTML, if there is one. Most products have none. */
    descriptionHtml?: string;
    categories: string[];
    technologies: string[];
  };
  existing: Array<{ title: string; detail?: string }>;
}

export async function proposeFeatures(
  input: ProposeFeaturesInput,
): Promise<{ features: Array<{ title: string; detail?: string }>; costMicros: number }> {
  const { name, summary, descriptionHtml, categories, technologies } = input.product;

  /*
   * Everything the product knows, not the description alone.
   *
   * The button used to be specified as "generate features from the description"
   * — and one of 1,010 published products has one. Reading the name, the
   * summary and the taxonomy the author has already chosen is what makes this
   * work on a real listing rather than on a hypothetical one.
   */
  const about = [
    `Name: ${name}`,
    `Summary: ${summary}`,
    descriptionHtml ? `Description (HTML): ${descriptionHtml}` : null,
    categories.length ? `Categories: ${categories.join(", ")}` : null,
    technologies.length ? `Built with: ${technologies.join(", ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const existing = input.existing
    .filter((feature) => feature.title.trim())
    .map((feature) => `- ${feature.title}${feature.detail ? ` — ${feature.detail}` : ""}`)
    .join("\n");

  const result = await extractStructured({
    config: input.config,
    schema: proposedFeaturesSchema,
    jsonSchema: PROPOSED_FEATURES_JSON_SCHEMA,
    schemaName: "proposed_features",
    system: FEATURES_SYSTEM,
    temperature: input.config.temperature,
    input: [
      `About the product:\n${about}`,
      existing ? `Features the author has already written:\n${existing}` : null,
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  return {
    // `detail: ""` is how the schema expresses "nothing to add" — the JSON
    // Schema has to mark it required under `strict: true`. Dropping the empty
    // string here means the form never renders a blank detail input as if the
    // model had said something.
    features: result.data.features.map((feature) => ({
      title: feature.title,
      ...(feature.detail ? { detail: feature.detail } : {}),
    })),
    costMicros: result.usage.costMicros,
  };
}

export { ExtractionFailedError };
