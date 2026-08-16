import "server-only";
import type { AiMessage } from "@/lib/db/models/requests";
import { searchMarketplace } from "@/services/marketplace";
import { parseMarketplaceQuery } from "@/services/marketplace/query";

/**
 * §24 — check whether we already sell what they are describing.
 *
 * ## Offered honestly, never forced
 *
 * §24 is unusually specific: *"Never force the marketplace option."* This
 * service therefore returns candidates and nothing else — no scoring that
 * pushes, no auto-redirect, no dismissal that has to be earned. The page shows
 * what each product covers **and what it doesn't**, and "continue with a custom
 * build" sits beside it as an equal.
 *
 * The business reason is worth stating: a customer talked into the wrong
 * product is a refund and a bad review, and a customer who finds the right one
 * is a sale that cost nothing to make. Both outcomes are better served by being
 * straight about the fit.
 *
 * ## Reuses ticket 08's search rather than a second one
 *
 * A separate matcher would drift from the marketplace's own idea of relevance,
 * so a product could be recommended here and unfindable there. `q` bypasses the
 * catalogue cache (unbounded key space), which is correct for a query built
 * from a transcript.
 */

export interface Recommendation {
  slug: string;
  name: string;
  summary?: string;
}

/**
 * Pull the nouns out of what the *customer* said.
 *
 * Deliberately not the whole transcript: the assistant's turns are full of our
 * vocabulary ("scheduling", "records", "reporting") and searching on those
 * matches half the catalogue regardless of what the customer wants.
 */
export function searchTermsFrom(messages: readonly AiMessage[]): string {
  const customerText = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content)
    .join(" ");

  const words = customerText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3 && !STOP_WORDS.has(word));

  // Most frequent first, capped: a text search with forty terms matches
  // everything and ranks nothing.
  const counts = new Map<string, number>();
  for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([word]) => word)
    .join(" ");
}

const STOP_WORDS = new Set([
  "want",
  "need",
  "would",
  "could",
  "should",
  "like",
  "have",
  "with",
  "that",
  "this",
  "they",
  "them",
  "their",
  "there",
  "about",
  "just",
  "really",
  "something",
  "anything",
  "everything",
  "people",
  "thing",
  "things",
  "make",
  "sure",
  "know",
  "think",
  "yeah",
  "okay",
  "please",
  "maybe",
  "also",
  "some",
  "much",
  "many",
  "from",
  "into",
  "when",
  "what",
  "where",
  "which",
  "your",
  "ours",
  "been",
  "were",
  "does",
  "doesn",
]);

export async function recommendProducts(
  messages: readonly AiMessage[],
  limit = 3,
): Promise<Recommendation[]> {
  const q = searchTermsFrom(messages);
  if (q.length < 4) return [];

  // Through the parser rather than hand-building the input: it supplies the
  // sort and currency defaults, and clamps the limit (§94). Building the object
  // directly here would be a second, quietly divergent idea of what a valid
  // marketplace query is.
  const result = await searchMarketplace(parseMarketplaceQuery({ q, limit: String(limit) }));

  return result.products.map((product) => ({
    slug: product.slug,
    name: product.name,
    ...(product.summary ? { summary: product.summary } : {}),
  }));
}
