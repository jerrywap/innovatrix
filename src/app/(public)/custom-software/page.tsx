import type { Metadata } from "next";
import { getSession } from "@/lib/auth/dal";
import { Assistant } from "@/features/requirements/components/assistant";
import {
  DiscoveryIntro,
  DiscoverySteps,
} from "@/features/requirements/components/discovery-intro";
import { Recommendations } from "@/features/requirements/components/recommendations";
import { openersFor } from "@/features/requirements/openers";
import { aiConfigured } from "@/services/ai/client";
import { readAnonymousKey, startOrResume } from "@/services/ai/conversation-service";
import { recommendProducts } from "@/services/ai/recommend";
import { resolveAiConfig } from "@/services/ai/settings";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Tell us what you need",
  description:
    "Describe the problem in your own words. We'll work out what software solves it, scope it, and send you a quote.",
  path: "/custom-software",
});

/**
 * "I have a problem, not a specification" — ticket 18, §21–25.
 *
 * ## Business first, technology never
 *
 * §22's rule is *understand the problem, not the technology*, and §100 bans our
 * vocabulary from the customer's side of the conversation. Both live in the
 * system prompt; what this page contributes is the framing — no field labelled
 * "tech stack", no dropdown of platforms.
 *
 * ## §24 runs from the transcript, not from a separate questionnaire
 *
 * Once the customer has said enough, the marketplace is searched with their own
 * words. If we already sell something close, it is offered — beside an equally
 * prominent "continue with a custom build", because §24 forbids forcing it.
 *
 * ## The page's own contribution is now the stage, not the furniture
 *
 * It used to render a `PageHeader`, three explainer cards and the conversation,
 * in that order, always — so somebody eight answers into an interview still
 * scrolled past the pitch to reach the composer, and the brief that came out of
 * it appeared as a third sibling below both. `Assistant` decides which of the four
 * states this is; the page supplies the pieces each state needs and no more.
 *
 * `PageHeader` is gone rather than restyled: its `<h1>` is `truncate`, so a real
 * headline cannot go through it, and the stage owns the heading now anyway.
 */

/**
 * How much of a typed brief we carry over.
 *
 * Long enough for a real paragraph, short enough that a URL cannot be used to
 * push a wall of text into a conversation. Anything longer is truncated rather
 * than rejected — they can still see and edit it before sending.
 */
const MAX_BRIEF = 600;

export default async function Page({
  searchParams,
}: {
  /*
   * Only ever read for `brief` — the homepage's "what are you looking to build?"
   * box (COS-7) hands the visitor's own words over instead of making them retype.
   *
   * Reading `searchParams` makes this page dynamic, which it already was: it
   * calls `getSession()` and `startOrResume()` in its own body.
   */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).brief;
  const first = Array.isArray(raw) ? raw[0] : raw;
  const brief = typeof first === "string" ? first.trim().slice(0, MAX_BRIEF) : "";

  const session = await getSession();
  // Read-only. `proxy.ts` mints this before the page runs — a Server
  // Component cannot set a cookie, and the first version of this tried to.
  const anonymousKey = session?.user.id ? undefined : await readAnonymousKey();

  /*
   * No owner means no conversation — and that is a page, not an error.
   *
   * `proxy.ts` mints a key for every visitor who could hold a conversation, so
   * in practice this branch is a crawler: the one caller deliberately excluded,
   * because a row per crawled page is a row per crawled page forever.
   *
   * It must still render. This is an indexable marketing page (§93), and
   * `startOrResume` now refuses an owner-less conversation rather than writing
   * one nobody can read — so calling it unconditionally would 500 Googlebot.
   */
  const owner = Boolean(session?.user.id || anonymousKey);

  const conversation = owner
    ? await startOrResume({
        contextType: "custom_build",
        ...(session?.user.id ? { userId: session.user.id } : {}),
        ...(session?.activeOrganizationId
          ? { organizationId: session.activeOrganizationId }
          : {}),
        ...(anonymousKey ? { anonymousKey } : {}),
      })
    : null;

  const config = await resolveAiConfig();
  const available = aiConfigured() && config.enabled;

  /*
   * Only once they have said something substantial, and only once. Searching
   * after the first "hello" recommends noise, and re-offering after they have
   * chosen is the nagging §24 explicitly rules out.
   */
  const shouldRecommend =
    conversation !== null &&
    !conversation.recommendationChoice &&
    conversation.messages.filter((message) => message.role === "user").length >= 2;

  const recommendations = shouldRecommend ? await recommendProducts(conversation.messages) : [];

  return (
    /*
     * Wider than the old `max-w-3xl`, because the review stage is two columns.
     * A brief plus a rail inside 768px is a brief plus a squeezed rail; 1024
     * gives the document its own measure and still reads as one page rather than
     * a dashboard.
     */
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-10">
      {!available && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]">
          Our assistant is unavailable at the moment. Write out what you need below and
          we&rsquo;ll pick it up from there — it reaches the same people either way.
        </p>
      )}

      {conversation === null ? (
        <>
          {/* The crawler branch still gets the invitation, because this is an
              indexable marketing page and the copy is the point of indexing it. */}
          <DiscoveryIntro />
          {/*
            A plain `<a>`, not a `<Link>`: this branch exists for clients the
            proxy will not mint a key for, and a full navigation is what gets
            them one.
          */}
          <p className="border-border bg-surface rounded-xl border px-4 py-3.5 text-[13.5px]">
            <a href="/custom-software" className="underline underline-offset-4">
              Start a conversation
            </a>{" "}
            and tell us what you need — it takes a couple of minutes.
          </p>
          <DiscoverySteps />
        </>
      ) : (
        <Assistant
          conversationId={String(conversation._id)}
          initialMessages={conversation.messages
            .filter((message) => message.role !== "system")
            .map((message) => ({
              role: message.role as "user" | "assistant",
              content: message.content,
            }))}
          signedIn={Boolean(session?.user.id)}
          signInHref={`/login?next=${encodeURIComponent("/custom-software")}`}
          startOverHref="/custom-software"
          workspaceTitle="Custom software request"
          intro={<DiscoveryIntro />}
          introFooter={<DiscoverySteps />}
          {...(recommendations.length > 0
            ? {
                aside: (
                  <Recommendations
                    conversationId={String(conversation._id)}
                    products={recommendations}
                  />
                ),
              }
            : {})}
          // Sampled here, in the Server Component, so the draw is serialised
          // into the RSC payload and the client renders the same four. Drawn
          // inside the `"use client"` island instead, server and client would
          // disagree at hydration.
          suggestions={conversation.messages.length === 0 ? openersFor(3) : undefined}
          // Only into an empty conversation. Dropping a brief into a
          // conversation already in progress would overwrite whatever they
          // were part-way through typing.
          {...(brief && conversation.messages.length === 0 ? { initialDraft: brief } : {})}
        />
      )}
    </div>
  );
}
