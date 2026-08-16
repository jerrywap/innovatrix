"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { fail, ok, parseInput, withAction, type ActionResult } from "@/lib/action-result";
import { getSession, requireOrg } from "@/lib/auth/dal";
import { AI_CONTEXT_TYPES, REQUIREMENT_ORIGINS } from "@/lib/db/enums";
import type { Requirement } from "@/lib/db/models/requests";
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
    notes?: string;
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
        ...(result.summary.notes ? { notes: result.summary.notes } : {}),
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
export async function submitRequirementsAction(
  _previous: unknown,
  formData: FormData,
): Promise<ActionResult<{ reference: string }>> {
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
    });

    revalidatePath("/dashboard/requests");
    return ok({ reference: request.reference });
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
