import { after } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/dal";
import { LIMITS, callerIp, consume, tooManyRequests } from "@/lib/rate-limit";
import { objectIdSchema } from "@/validators/common";
import { DomainError, NotFoundError } from "@/lib/errors";
import { streamAssistantTurn } from "@/services/ai/chat";
import { aiConfigured } from "@/services/ai/client";
import {
  appendMessage,
  getConversation,
  readAnonymousKey,
} from "@/services/ai/conversation-service";
import { productContext, systemPrompt } from "@/services/ai/prompts";
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

  let conversation;
  try {
    conversation = await getConversation(id.data, {
      ...(session?.user.id ? { userId: session.user.id } : {}),
      ...(session?.activeOrganizationId
        ? { organizationId: session.activeOrganizationId }
        : {}),
      ...(anonymousKey ? { anonymousKey } : {}),
    });
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
        ...(conversation.productVersionNumber
          ? { version: conversation.productVersionNumber }
          : {}),
        features: product.features,
        customizationAreas: product.customizationAreas,
      })}`;
    }
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
            send("done", {
              content: result.message.content,
              // The client discards what it rendered and shows this instead.
              replaced: result.replaced,
              truncated: result.truncated,
            });
            if (!closed) controller.close();
            closed = true;

            // Outside the response, so a disconnected browser still gets the
            // turn written down.
            after(async () => {
              await appendMessage(id.data, result.message);
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
 * Read straight from the model rather than through `getProductDetail`: the
 * interview needs `customization.suggestedAreas`, which is staff-authored and
 * deliberately absent from the cached customer-facing DTO.
 */
async function productDetailFor(productId: string) {
  try {
    const { Product } = await import("@/lib/db/models/catalog");
    const product = await Product.findById(productId)
      .select({ name: 1, summary: 1, features: 1, customization: 1 })
      .lean<{
        name: string;
        summary?: string;
        features?: { title: string }[];
        customization?: { suggestedAreas?: string[] };
      }>();
    if (!product) return null;

    return {
      name: product.name,
      summary: product.summary,
      features: (product.features ?? []).map((feature) => feature.title),
      // §50 — what staff flagged as sensibly customisable. This is what makes
      // the interview product-specific rather than generic.
      customizationAreas: product.customization?.suggestedAreas ?? [],
    };
  } catch {
    return null;
  }
}

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
