import "server-only";
import { z } from "zod";
import { objectIdSchema } from "@/validators/common";
import { LIMITS, consume } from "@/lib/rate-limit";
import { aiConfigured } from "@/services/ai/client";
import { resolveAiConfig, type ResolvedAiConfig } from "@/services/ai/settings";
import type { ProductDoc } from "@/lib/db/models/catalog";
import { plainText } from "@/lib/rich-text/schema";
import { loadTaxonomyOptions } from "./wizard";

/**
 * The parts of the four AI authoring actions that are identical on both
 * surfaces.
 *
 * ## Deliberately not a factory
 *
 * It would be tidier to wrap the whole action, and it is exactly what
 * `vendors/product-actions.ts` warns against: *"A factory that closed over the
 * guard in another module would pass this file's actions off as guarded without
 * the test being able to see it."* So the guard stays written out in each
 * action's own body, and only what comes *after* it lives here.
 *
 * This module has no `"use server"` on purpose — that directive is what marks a
 * file as an action module for `action-guards.test.ts`, and these are helpers,
 * not endpoints.
 */

/* ────────────────────────────────────────────── input */

/**
 * What the browser sends for a rewrite.
 *
 * **No product id.** The basics step and the create form post the same three
 * fields, and on `/new` there is no product yet — so the rewrite works on what
 * is in the form rather than on what is in the database. That is what lets one
 * action serve both screens.
 */
export const enhanceProseInputSchema = z.object({
  field: z.enum(["summary", "description", "seoTitle", "seoDescription"]),
  /** Plain text for a summary; the editor's HTML for a description. */
  text: z.string().max(40_000),
  name: z.string().max(200).optional(),
  summary: z.string().max(2_000).optional(),
  description: z.string().max(40_000).optional(),
});

/** Features always have a product — the content step is never reached without one. */
export const proposeFeaturesInputSchema = z.object({
  productId: objectIdSchema,
  existing: z
    .array(z.object({ title: z.string().max(200), detail: z.string().max(1_000).optional() }))
    .max(60)
    .default([]),
});

/* ────────────────────────────────────────────── preflight */

export type Preflight = { ok: true; config: ResolvedAiConfig } | { ok: false; message: string };

/**
 * Rate limit, then configured, then enabled — in that order, and after the
 * caller's own guard.
 *
 * The order is `summariseConversationAction`'s, which documents it: the limit is
 * consumed **before** the paid call so a flood never reaches the provider, and
 * **after** the cheap checks so a malformed request spends no budget.
 *
 * Every refusal is a sentence the author can act on, because none of them is an
 * error — AI being unavailable means "write it yourself", which is what the
 * whole app already degrades to.
 */
export async function aiPreflight(identity: string): Promise<Preflight> {
  const budget = await consume(LIMITS.aiAuthor, identity);
  if (!budget.allowed) {
    return {
      ok: false,
      message:
        "You've used the writing help a lot in the last hour. Give it a little while — " +
        "or keep going by hand, which is what it was drafting from anyway.",
    };
  }

  if (!aiConfigured()) {
    return { ok: false, message: "Writing help is unavailable. Write it yourself for now." };
  }

  const config = await resolveAiConfig();
  if (!config.enabled) {
    return { ok: false, message: "Writing help is switched off. Write it yourself for now." };
  }

  return { ok: true, config };
}

/* ────────────────────────────────────────────── product context */

/**
 * Everything a feature proposal should read, from the product document.
 *
 * ## Why the taxonomy is resolved to names
 *
 * `categoryIds` are ObjectIds. Handing those to a model is handing it noise it
 * will either ignore or hallucinate meaning from. `loadTaxonomyOptions` is
 * `cache()`-wrapped and already loaded on the wizard pages, so resolving them
 * costs nothing on a request that has rendered one.
 *
 * ## Why the description goes as text, not HTML
 *
 * A feature list is derived *from* the description; it does not reproduce its
 * formatting. `plainText` is destructive — it collapses every block boundary —
 * and that is fine here in a way it is not for a rewrite: what the model needs
 * is the words. The one place it must never be used is the round trip in
 * `authoring.ts`, and that path does not touch this function.
 */
export async function productAuthoringContext(product: ProductDoc): Promise<{
  name: string;
  summary: string;
  descriptionHtml?: string;
  categories: string[];
  technologies: string[];
}> {
  const taxonomy = await loadTaxonomyOptions();
  const nameFor = (
    options: Array<{ id: string; name: string }>,
    ids: readonly unknown[] | undefined,
  ) => {
    const wanted = new Set((ids ?? []).map(String));
    return options.filter((option) => wanted.has(option.id)).map((option) => option.name);
  };

  const description = product.description ? plainText(product.description) : "";

  return {
    name: product.name,
    summary: product.summary,
    ...(description ? { descriptionHtml: description } : {}),
    categories: nameFor(taxonomy.category, product.categoryIds),
    technologies: nameFor(taxonomy.technology, product.technologyIds),
  };
}
