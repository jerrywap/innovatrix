"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { getSession, requireOrg } from "@/lib/auth/dal";
import { AI_CONTEXT_TYPES, REQUIREMENT_ORIGINS, type RequestStatus } from "@/lib/db/enums";
import type { Requirement } from "@/lib/db/models/requests";
import { LIMITS, consume } from "@/lib/rate-limit";
import { objectIdSchema } from "@/validators/common";
import { aiConfigured } from "@/services/ai/client";
import {
  abandon,
  claimForUser,
  ensureAnonymousKey,
  getConversation,
  readAnonymousKey,
  recordRecommendation,
  startOrResume,
} from "@/services/ai/conversation-service";
import { resolveAiConfig } from "@/services/ai/settings";
import { ExtractionFailedError, summariseConversation } from "@/services/ai/summary";
import { submitFromConversation } from "@/services/requests/request-service";

/**
 * The two AI doors — tickets 17 and 18.
 *
 * ## Degradation is a first-class path, not an error handler
 *
 * §104 and the ticket-16 criteria both require that a customer can submit when
 * the assistant cannot help. So `summariseConversationAction` returning a
 * failure is an ordinary outcome the UI handles by showing the manual form, and
 * `submitRequirementsAction` does not care whether the requirements came from a
 * model or a person typing — it takes the same shape either way.
 */

/* ────────────────────────────────────────────── start */

export async function startConversationAction(
  input: unknown,
): Promise<ActionResult<{ conversationId: string }>> {
  return withAction(async () => {
    const parsed = parseInput(
      z.object({
        contextType: z.enum(AI_CONTEXT_TYPES),
        productId: objectIdSchema.optional(),
        productVersionId: objectIdSchema.optional(),
        productVersionNumber: z.string().trim().max(40).optional(),
      }),
      input,
    );

    const session = await getSession();

    // Anonymous visitors may start (§17, §18); the cookie is what carries the
    // conversation until they sign in.
    const anonymousKey = session?.user.id ? undefined : await ensureAnonymousKey();

    const conversation = await startOrResume({
      contextType: parsed.contextType,
      ...(parsed.productId ? { productId: parsed.productId } : {}),
      ...(parsed.productVersionId ? { productVersionId: parsed.productVersionId } : {}),
      ...(parsed.productVersionNumber
        ? { productVersionNumber: parsed.productVersionNumber }
        : {}),
      ...(session?.user.id ? { userId: session.user.id } : {}),
      ...(session?.activeOrganizationId
        ? { organizationId: session.activeOrganizationId }
        : {}),
      ...(anonymousKey ? { anonymousKey } : {}),
    });

    return ok({ conversationId: String(conversation._id) });
  });
}

/**
 * Attach anything started before sign-in to the new account — §17.
 *
 * Called from the same place the cart merge is called. Losing an interview at
 * the sign-up step would be the single most annoying possible moment to lose
 * it, which is why this exists rather than relying on the customer not signing
 * in halfway.
 */
export async function claimConversationsAction(): Promise<ActionResult<{ claimed: number }>> {
  return withAction(async () => {
    const { user, organizationId } = await requireOrg();
    const anonymousKey = await readAnonymousKey();
    if (!anonymousKey) return ok({ claimed: 0 });

    return ok({ claimed: await claimForUser(anonymousKey, user.id, organizationId) });
  });
}

export async function abandonConversationAction(
  conversationId: string,
): Promise<ActionResult<{ abandoned: true }>> {
  return withAction(async () => {
    const session = await getSession();
    const anonymousKey = await readAnonymousKey();

    await abandon(conversationId, {
      ...(session?.user.id ? { userId: session.user.id } : {}),
      ...(session?.activeOrganizationId
        ? { organizationId: session.activeOrganizationId }
        : {}),
      ...(anonymousKey ? { anonymousKey } : {}),
    });

    return ok({ abandoned: true as const });
  });
}

/* ────────────────────────────────────────────── summarise */

export interface SummaryLine {
  key: string;
  label: string;
  detail?: string;
  origin: (typeof REQUIREMENT_ORIGINS)[number];
}

export async function summariseConversationAction(conversationId: string): Promise<
  ActionResult<{
    title: string;
    lines: SummaryLine[];
    businessContext?: string;
    integrations: string[];
    timeline?: string;
  }>
> {
  return withAction(async () => {
    const session = await getSession();
    const anonymousKey = await readAnonymousKey();

    const conversation = await getConversation(conversationId, {
      ...(session?.user.id ? { userId: session.user.id } : {}),
      ...(session?.activeOrganizationId
        ? { organizationId: session.activeOrganizationId }
        : {}),
      ...(anonymousKey ? { anonymousKey } : {}),
    });

    if (conversation.messages.length < 2) {
      return fail("There isn't enough here to summarise yet. Answer a question or two first.");
    }

    // Nothing to redraft. The review panel replaces itself with the reference on
    // success so this should be unreachable from the UI, but the action is a
    // public POST and drafting is the expensive thing on this page.
    if (conversation.status !== "active") {
      return fail("You've already sent this one to us.");
    }

    /*
     * Cost protection, and the reason this limit is tighter than a turn.
     *
     * Drafting re-extracts the entire transcript at up to the full output
     * allowance, at `temperature: 0`, with an automatic retry on a second
     * strategy if the first parse fails — so one press can be two paid calls.
     * And unlike a turn, it is *repeatable without saying anything new*: the
     * button sits there and the transcript does not have to change for the price
     * to be charged again.
     *
     * Keyed the same way as `aiTurn`: the signed-in id where there is one, the
     * anonymous conversation key otherwise, so clearing a cookie does not buy a
     * fresh allowance. Falling back to the conversation id is the last resort —
     * it is at least per-conversation rather than global.
     */
    const budget = await consume(
      LIMITS.aiExtract,
      session?.user.id ?? anonymousKey ?? conversationId,
    );
    if (!budget.allowed) {
      return fail(
        "You've redrafted this a few times in a row. Give it a minute, or edit the " +
          "brief below by hand — nothing you've told us is lost.",
      );
    }

    if (!aiConfigured()) {
      return fail("The assistant is unavailable. Use the form to describe what you need.");
    }

    const config = await resolveAiConfig();
    if (!config.enabled) {
      return fail("The assistant is switched off. Use the form to describe what you need.");
    }

    try {
      const result = await summariseConversation({
        config,
        contextType: conversation.contextType,
        messages: conversation.messages,
        // Without this the preface in `summary.ts` is dead code: it is written to
        // tell the extractor that requirements are *changes to a named product*
        // rather than a whole system, and it has been guarded on a `productName`
        // that no caller passed.
        ...(await productNameFor(conversation.productId)),
      });

      return ok({
        title: result.summary.title,
        lines: result.summary.requirements.map((line) => ({
          key: line.key,
          label: line.label,
          ...(line.detail ? { detail: line.detail } : {}),
          origin: line.origin,
        })),
        ...(result.summary.businessContext
          ? { businessContext: result.summary.businessContext }
          : {}),
        integrations: result.summary.integrations,
        ...(result.summary.timeline ? { timeline: result.summary.timeline } : {}),
        /*
         * `result.summary.notes` is deliberately **not** returned.
         *
         * It used to seed the customer's "Anything else" box, which put sentences
         * like "Conversation is in early discovery; the customer has not yet
         * answered which manual processes cause the biggest issues" into a field
         * attributed to the customer. That is our reading of the conversation, in
         * their voice, in a field they are then invited to submit.
         *
         * The box now starts empty and holds only what they write. The extractor
         * still produces the observation; giving it a home staff can read is a
         * column and a surface this change does not add.
         */
      });
    } catch (error) {
      if (error instanceof ExtractionFailedError) {
        // Retried once with the other strategy already. Rather than saving a
        // half-parsed object, hand the customer the form — their answers are
        // all still in the transcript.
        return fail(
          "We couldn't turn that into a summary. You can write it out yourself below — " +
            "nothing you've told us is lost.",
        );
      }
      throw error;
    }
  });
}

/* ────────────────────────────────────────────── submit */

const submitSchema = z.object({
  conversationId: objectIdSchema,
  title: z.string().trim().min(3, "Give this a short name").max(140),
  lines: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        label: z.string().trim().min(1, "Say what you need").max(200),
        detail: z.string().trim().max(600).optional(),
        origin: z.enum(REQUIREMENT_ORIGINS),
        /** Ticked ⇒ the customer is confirming it, whatever the AI thought. */
        accepted: z.coerce.boolean().default(false),
      }),
    )
    .min(1, "Add at least one thing you need"),
  timeline: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(1200).optional(),
});

/**
 * The customer's edits are what gets submitted — §18.
 *
 * ## The customer's tick decides `origin`, not the model's guess
 *
 * A line the assistant marked `assumed` that the customer then ticks becomes
 * `confirmed`, because they just confirmed it — that is the entire point of the
 * review step. A line they leave unticked stays an assumption however sure the
 * model was. §34's "customer-confirmed" has to mean the customer confirmed it.
 */
/**
 * What the confirmation needs to show, straight from the created request.
 *
 * `submittedAt` and `status` rather than the client assuming them: the timestamp
 * is the server's and stamping a second one in the browser would disagree with
 * the request page by however far the two clocks are apart, and the status is the
 * state machine's answer rather than a constant this file would have to keep in
 * step with `submitFromConversation`.
 */
export async function submitRequirementsAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ reference: string; submittedAt?: string; status: RequestStatus }>> {
  return withAction(async () => {
    // Submitting requires an account — an anonymous request has nobody to send
    // the quote to. Anything started anonymously was claimed at sign-in.
    const { user, organizationId } = await requireOrg();

    const parsed = parseInput(submitSchema, parseFormPayload(formData));

    const conversation = await getConversation(parsed.conversationId, {
      userId: user.id,
      organizationId,
    });

    if (conversation.status === "submitted") {
      return fail("You've already sent this one to us.");
    }

    const confirmed: Requirement[] = [];
    const assumptions: Requirement[] = [];

    for (const line of parsed.lines) {
      const requirement: Requirement = {
        key: line.key,
        label: line.label,
        ...(line.detail ? { detail: line.detail } : {}),
        origin: line.accepted
          ? "confirmed"
          : line.origin === "confirmed"
            ? "assumed"
            : line.origin,
        acceptedByCustomer: line.accepted,
      };
      (line.accepted ? confirmed : assumptions).push(requirement);
    }

    if (confirmed.length === 0) {
      return fail("Tick at least one thing so we know what you actually want.");
    }

    const request = await submitFromConversation({
      conversationId: parsed.conversationId,
      kind: conversation.contextType === "customization" ? "customization" : "custom_build",
      title: parsed.title,
      organizationId,
      userId: user.id,
      ...(user.name ? { userName: user.name } : {}),
      customerRequirements: confirmed,
      assumptions,
      ...(conversation.productId ? { baseProductId: String(conversation.productId) } : {}),
      ...(conversation.productVersionId
        ? { baseProductVersionId: String(conversation.productVersionId) }
        : {}),
      ...(conversation.productVersionNumber
        ? { baseProductVersionNumber: conversation.productVersionNumber }
        : {}),
      ...(parsed.timeline ? { desiredTimeline: parsed.timeline } : {}),
      // Validated since the day the field shipped, and until now dropped on the
      // floor immediately afterwards.
      ...(parsed.notes ? { customerNotes: parsed.notes } : {}),
    });

    revalidatePath("/dashboard/requests");
    return ok({
      reference: request.reference,
      ...(request.submittedAt ? { submittedAt: request.submittedAt.toISOString() } : {}),
      status: request.status,
    });
  });
}

/**
 * `lines[0][label]` → a nested array.
 *
 * The shared `parseNestedFormData` handles this shape already, but checkboxes
 * need the extra step: an unticked box submits **nothing at all**, so a missing
 * `accepted` has to become `false` rather than `undefined` — otherwise Zod's
 * default fires and every unticked line silently reads as ticked.
 */
function parseFormPayload(formData: FormData): unknown {
  const lines: Record<string, Record<string, unknown>> = {};
  const flat: Record<string, unknown> = {};

  for (const [name, value] of formData.entries()) {
    const match = /^lines\[(\d+)]\[(\w+)]$/.exec(name);
    if (match) {
      const [, index, field] = match;
      (lines[index!] ??= {})[field!] = value;
      continue;
    }
    flat[name] = value;
  }

  return {
    ...flat,
    lines: Object.keys(lines)
      .sort((a, b) => Number(a) - Number(b))
      .map((index) => ({
        ...lines[index],
        accepted: lines[index]!.accepted === "on",
      })),
  };
}

/* ────────────────────────────────────────────── §24 recommendations */

/**
 * Record what we offered instead of a custom build, and what they picked.
 *
 * §24 asks for this explicitly, and it is the most commercially useful thing
 * these conversations produce: a list of custom requests the catalogue could
 * already have served tells us what to build next.
 *
 * Recording the choice must never be able to fail the customer's journey, so
 * the caller fires it and moves on — a lost analytics row is cheaper than a
 * blocked navigation.
 */
export async function recordRecommendationChoiceAction(
  input: unknown,
): Promise<ActionResult<{ recorded: true }>> {
  return withAction(async () => {
    const parsed = parseInput(
      z.object({
        conversationId: objectIdSchema,
        choice: z.enum(["existing_product", "custom_build"]),
        shownSlugs: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
      }),
      input,
    );

    const session = await getSession();
    const anonymousKey = await readAnonymousKey();

    // Scope-checked like every other read, so this is not a way to write into
    // somebody else's conversation.
    await getConversation(parsed.conversationId, {
      ...(session?.user.id ? { userId: session.user.id } : {}),
      ...(session?.activeOrganizationId
        ? { organizationId: session.activeOrganizationId }
        : {}),
      ...(anonymousKey ? { anonymousKey } : {}),
    });

    await recordRecommendation(parsed.conversationId, parsed.choice, parsed.shownSlugs);
    return ok({ recorded: true as const });
  });
}

/**
 * The product's name, shaped as a spreadable `{ productName }` or nothing.
 *
 * Its own read rather than a field on the conversation: the name is denormalised
 * nowhere, and a rename between the interview and the brief should show the
 * current name, since that is what the customer sees on the listing.
 *
 * Never throws. A missing product costs the extractor one line of context, and
 * losing the whole draft over it would be a poor trade.
 */
async function productNameFor(productId: unknown): Promise<{ productName?: string }> {
  if (!productId) return {};

  try {
    const { Product } = await import("@/lib/db/models/catalog");
    const product = await Product.findById(productId)
      .select({ name: 1 })
      .lean<{ name: string }>();
    return product ? { productName: product.name } : {};
  } catch {
    return {};
  }
}
