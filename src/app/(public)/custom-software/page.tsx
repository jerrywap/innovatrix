import type { Metadata } from "next";
import { ClipboardList, MessagesSquare, Receipt } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/auth/dal";
import { Assistant } from "@/features/requirements/components/assistant";
import { Recommendations } from "@/features/requirements/components/recommendations";
import { openersFor } from "@/features/requirements/openers";
import { aiConfigured } from "@/services/ai/client";
import { readAnonymousKey, startOrResume } from "@/services/ai/conversation-service";
import { recommendProducts } from "@/services/ai/recommend";
import { resolveAiConfig } from "@/services/ai/settings";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Build custom software",
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
 */
export default async function Page() {
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
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10">
      <PageHeader
        title="Build custom software"
        description="Tell us what you're trying to do — in your words, not ours. We'll work out what it needs to be."
      />

      {(conversation === null || conversation.messages.length === 0) && (
        <ol className="grid gap-3 sm:grid-cols-3">
          <Step icon={MessagesSquare} n="1" title="You describe the problem">
            A few questions, one at a time. No forms and no jargon.
          </Step>
          <Step icon={ClipboardList} n="2" title="You check the summary">
            Everything we understood, in a document you can edit before sending.
          </Step>
          <Step icon={Receipt} n="3" title="We scope and quote it">
            A person reviews it and sends a written quote. No prices before that.
          </Step>
        </ol>
      )}

      {!available && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]">
          Our assistant is unavailable at the moment. Write out what you need below and
          we&rsquo;ll pick it up from there — it reaches the same people either way.
        </p>
      )}

      {conversation === null ? (
        // A plain `<a>`, not a `<Link>`: this branch exists for clients the
        // proxy will not mint a key for, and a full navigation is what gets
        // them one.
        <p className="border-border bg-surface rounded-xl border px-4 py-3.5 text-[13.5px]">
          <a href="/custom-software" className="underline underline-offset-4">
            Start a conversation
          </a>{" "}
          and tell us what you need — it takes a couple of minutes.
        </p>
      ) : (
        <>
          {recommendations.length > 0 && (
            <Recommendations
              conversationId={String(conversation._id)}
              products={recommendations}
            />
          )}

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
            // Sampled here, in the Server Component, so the draw is serialised
            // into the RSC payload and the client renders the same four. Drawn
            // inside the `"use client"` island instead, server and client would
            // disagree at hydration.
            suggestions={conversation.messages.length === 0 ? openersFor(3) : undefined}
          />
        </>
      )}
    </div>
  );
}

function Step({
  icon: Icon,
  n,
  title,
  children,
}: {
  icon: typeof MessagesSquare;
  n: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
      <span className="bg-surface-muted text-muted-foreground grid size-8 place-items-center rounded-lg">
        <Icon className="size-4" aria-hidden />
      </span>
      <p className="text-[14px] font-medium">
        <span className="text-subtle font-mono text-[11px]">{n}. </span>
        {title}
      </p>
      <p className="text-muted-foreground text-[12.5px]">{children}</p>
    </li>
  );
}
