import { after } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { LIMITS, callerIp, consume, tooManyRequests } from "@/lib/rate-limit";
import { objectIdSchema } from "@/validators/common";
import { splitAssistantOptions } from "@/lib/assistant-options";
import { DomainError, NotFoundError } from "@/lib/errors";
import { streamAssistantTurn } from "@/services/ai/chat";
import { aiConfigured } from "@/services/ai/client";
import {
  appendMessage,
  carriedCustomerMessages,
  getConversation,
  readAnonymousKey,
} from "@/services/ai/conversation-service";
import { carriedContext, productContext, systemPrompt } from "@/services/ai/prompts";
import { resolveAiConfig } from "@/services/ai/settings";

/**
 * `POST /api/ai/[conversationId]` — one turn, streamed as SSE.
 *
 * ## Why a route handler and not a Server Action
 *
 * Server Actions cannot stream to the browser incrementally. Token-by-token is
 * an acceptance criterion and it is also the difference between a conversation
 * and a form that pauses for six seconds, so the transport has to be one that
 * streams.
 *
 * ## The turn is persisted even if the browser leaves
 *
 * `request.signal` is deliberately **not** forwarded to the model call. A
 * customer who refreshes mid-answer has already paid for the generation; the
 * useful thing is to finish it and write it down. `after()` flushes the
 * persistence outside the response lifetime so it happens whether or not the
 * stream was still being read.
 *
 * ## Scope is checked before anything else
 *
 * `getConversation` throws `NotFoundError` for another organisation's
 * conversation, so the SSE endpoint is not a way around the page-level check —
 * an explicit acceptance criterion, and the transcript is §19 evidence.
 */

const bodySchema = z
  .object({
    message: z.string().trim().min(1).max(4000),
  })
  // Ticket 26. A JSON body with an extra key on this endpoint is a client
  // trying something — a `model`, a `systemPrompt`, a `maxTokens` — and the
  // right answer is 400 rather than silently ignoring it.
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ conversationId: string }> },
): Promise<Response> {
  const { conversationId } = await context.params;

  const id = objectIdSchema.safeParse(conversationId);
  if (!id.success) return problem(404, "No such conversation.");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "Expected JSON.");
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return problem(400, "A message is required.");

  const session = await getSession();
  const anonymousKey = await readAnonymousKey();

  /*
   * §88's per-user AI cap — cost protection, not abuse protection.
   *
   * Every turn is a model call we are billed for, and §71 puts the custom-build
   * door in front of anonymous visitors on purpose. Keyed on the user when
   * there is one and the IP otherwise, so a signed-in customer's budget follows
   * them across devices and an anonymous visitor cannot get a fresh budget by
   * clearing a cookie.
   *
   * After the scope-cheap checks and before the expensive one, so a malformed
   * request does not spend budget and a well-formed flood does not reach the
   * provider.
   */
  const budget = await consume(LIMITS.aiTurn, session?.user.id ?? callerIp(request));
  // `tooManyRequests` rather than `problem(429, …)`, because a 429 without a
  // `Retry-After` tells a client to back off and not for how long, so it picks.
  if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

  // Named, because the carried-conversation read below has to be scoped by the
  // same viewer — a second conversation is a second thing to authorise.
  const viewer = {
    ...(session?.user.id ? { userId: session.user.id } : {}),
    ...(session?.activeOrganizationId ? { organizationId: session.activeOrganizationId } : {}),
    ...(anonymousKey ? { anonymousKey } : {}),
  };

  let conversation;
  try {
    conversation = await getConversation(id.data, viewer);
  } catch (error) {
    if (error instanceof NotFoundError) return problem(404, "No such conversation.");
    throw error;
  }

  if (conversation.status !== "active") {
    return problem(409, "This conversation has already been submitted.");
  }

  if (!aiConfigured()) {
    // §104: the customer is told plainly and pointed at the form, rather than
    // being left with a spinner.
    return problem(503, "The assistant is unavailable. You can use the form instead.");
  }

  const config = await resolveAiConfig();
  if (!config.enabled) {
    return problem(503, "The assistant is switched off. You can use the form instead.");
  }

  /* ── build the prompt ─────────────────────────────────────── */

  let system = systemPrompt(conversation.contextType);

  if (conversation.productId) {
    // Volatile context last, after the stable prefix.
    const product = await productDetailFor(String(conversation.productId));
    if (product) {
      system += `\n\n${productContext({
        name: product.name,
        ...(product.summary ? { summary: product.summary } : {}),
        ...(product.description ? { description: product.description } : {}),
        ...(conversation.productVersionNumber
          ? { version: conversation.productVersionNumber }
          : {}),
        ...(product.category ? { category: product.category } : {}),
        ...(product.industry ? { industry: product.industry } : {}),
        features: product.features,
        addons: product.addons,
        technologies: product.technologies,
        licenceTerms: product.licenceTerms,
        customizationAreas: product.customizationAreas,
      })}`;
    }
  }

  /*
   * §24 — what they told the custom-build interview before choosing this product.
   *
   * After the product, because the product is what the interview is *about* and
   * this is background to it. Their turns only; `carriedCustomerMessages` says why.
   */
  if (conversation.carriedFromConversationId) {
    const carried = await carriedCustomerMessages(
      String(conversation.carriedFromConversationId),
      viewer,
    );
    if (carried.length > 0) system += `\n\n${carriedContext(carried)}`;
  }

  const history = conversation.messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  /* ── persist the customer's turn before generating ────────── */

  const userMessage = {
    role: "user" as const,
    content: parsed.data.message,
    at: new Date(),
  };
  await appendMessage(id.data, userMessage);

  /* ── stream ───────────────────────────────────────────────── */

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // The reader went away mid-turn. Generation continues regardless —
          // see the note at the top of this file.
          closed = true;
        }
      };

      void streamAssistantTurn(
        { config, system, history, userMessage: parsed.data.message },
        {
          onDelta: (text) => send("delta", { text }),

          onDone: (result) => {
            /*
             * The options marker comes off here, once, and everything downstream
             * sees the reply without it.
             *
             * Order matters and it is not arbitrary. `streamAssistantTurn` has
             * already run the §73 guardrails over the **whole** completion,
             * marker included, so an option offering "from £500" trips the
             * withheld-content path exactly like the same words in prose would.
             * Stripping first would have opened a channel the guardrail does not
             * watch.
             *
             * Persisting the stripped text is the other half. The transcript is
             * §19 evidence that staff read and it is replayed to the model as
             * history — neither wants our delimiter in it, and a marker in the
             * history is an invitation to imitate it in the wrong place.
             */
            const { text, options } = splitAssistantOptions(result.message.content);

            send("done", {
              content: text,
              options,
              // The client discards what it rendered and shows this instead.
              replaced: result.replaced,
              truncated: result.truncated,
            });
            if (!closed) controller.close();
            closed = true;

            // Outside the response, so a disconnected browser still gets the
            // turn written down.
            after(async () => {
              await appendMessage(id.data, { ...result.message, content: text });
            });
          },

          onError: (error) => {
            send("error", {
              message:
                error instanceof DomainError
                  ? error.message
                  : "The assistant had a problem. Everything you've told us so far is saved.",
            });
            if (!closed) controller.close();
            closed = true;
          },
        },
      );
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-transform",
      connection: "keep-alive",
      // Stops nginx and friends buffering the whole stream and defeating it.
      "x-accel-buffering": "no",
    },
  });
}

/**
 * The bits of a product the interview needs. `null` when it has gone away.
 *
 * Read straight from the model rather than through `getProductDetail`, for two
 * reasons: that read takes a slug and a conversation stores an id, and it filters
 * on `status: "published"` — so a request against a product that has since been
 * unpublished would silently lose its context mid-interview, which is the one
 * moment the context matters most.
 *
 * ## Why it selects so much more than it used to
 *
 * It used to select `{ name, summary, features, customization }` and map the
 * features to their titles. Reasonable, until you count the catalogue: `features`
 * is set on eleven products out of a thousand and `suggestedAreas` on none, so
 * for practically every listing this returned a name and one sentence and the
 * assistant interviewed accordingly. Everything added below is a field a listing
 * really does carry, so the common case stops being the empty one.
 *
 * `feature.detail` now travels with `feature.title`. It was being discarded, and
 * it is the half that says what the feature actually does.
 */
async function productDetailFor(productId: string) {
  try {
    const { Product } = await import("@/lib/db/models/catalog");

    const product = await Product.findById(productId)
      .select({
        name: 1,
        summary: 1,
        descriptionText: 1,
        features: 1,
        addons: 1,
        facets: 1,
        licencePackages: 1,
        customization: 1,
      })
      .lean<{
        name: string;
        summary?: string;
        descriptionText?: string;
        features?: { title: string; detail?: string }[];
        addons?: { name: string }[];
        facets?: string[];
        licencePackages?: {
          name: string;
          activationLimit?: number;
          supportMonths?: number;
          updateMonths?: number;
        }[];
        customization?: { suggestedAreas?: string[] };
      }>();
    if (!product) return null;

    const names = await taxonomyNames(product.facets ?? []);

    return {
      name: product.name,
      summary: product.summary,
      description: product.descriptionText,
      category: names.category,
      industry: names.industry,
      technologies: names.technologies,
      features: (product.features ?? []).map((feature) =>
        feature.detail ? `${feature.title} — ${feature.detail}` : feature.title,
      ),
      // Names only. `productContext` explains why the prices stay behind.
      addons: (product.addons ?? []).map((addon) => addon.name),
      licenceTerms: licenceTerms(product.licencePackages ?? []),
      // §50 — what staff flagged as sensibly customisable. This is what makes
      // the interview product-specific rather than generic.
      customizationAreas: product.customization?.suggestedAreas ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * Facet slugs → the names a person would recognise.
 *
 * A targeted query rather than `getTaxonomyIndex()`, which is a `"use cache"`
 * read belonging to the marketplace layer. Pulling a cached catalogue-wide index
 * into an SSE handler to name three terms is the wrong trade, and it would couple
 * the assistant to a cache scoped by catalogue for reasons that have nothing to
 * do with it.
 *
 * Matched on kind **and** slug: nothing stops a category and an industry sharing
 * a slug, and "Finance" is in fact both.
 */
async function taxonomyNames(
  facets: string[],
): Promise<{ category?: string; industry?: string; technologies: string[] }> {
  const { Taxonomy, parseFacet, FACET_PREFIX } = await import("@/lib/db/models/catalog");

  const kindFor = new Map<string, "category" | "industry" | "technology">([
    [FACET_PREFIX.category, "category"],
    [FACET_PREFIX.industry, "industry"],
    [FACET_PREFIX.technology, "technology"],
  ]);

  const wanted: { kind: "category" | "industry" | "technology"; slug: string }[] = [];
  for (const facet of facets) {
    const parsed = parseFacet(facet);
    const kind = parsed && kindFor.get(parsed.prefix);
    if (parsed && kind) wanted.push({ kind, slug: parsed.slug });
  }
  if (wanted.length === 0) return { technologies: [] };

  const rows = await Taxonomy.find({ isActive: true, $or: wanted })
    .select({ kind: 1, name: 1 })
    .lean<{ kind: string; name: string }[]>();

  const first = (kind: string) => rows.find((row) => row.kind === kind)?.name;

  return {
    ...(first("category") ? { category: first("category")! } : {}),
    ...(first("industry") ? { industry: first("industry")! } : {}),
    technologies: rows.filter((row) => row.kind === "technology").map((row) => row.name),
  };
}

/**
 * Licence terms as sentences, so the assistant can answer "can I put it on two
 * sites" without being handed a price to be tempted by.
 *
 * The first package only. A listing with three tiers differs between them mostly
 * on price, which is the one thing that must not reach the model.
 */
function licenceTerms(
  packages: {
    name: string;
    activationLimit?: number;
    supportMonths?: number;
    updateMonths?: number;
  }[],
): string[] {
  const first = packages[0];
  if (!first) return [];

  const terms = [`Licence: ${first.name}`];
  if (first.activationLimit) {
    terms.push(
      first.activationLimit === 1
        ? "One installation"
        : `Up to ${first.activationLimit} installations`,
    );
  }
  if (first.updateMonths) terms.push(`${first.updateMonths} months of updates`);
  if (first.supportMonths) terms.push(`${first.supportMonths} months of support`);
  return terms;
}

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
