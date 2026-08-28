import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/dal";
import { Assistant } from "@/features/requirements/components/assistant";
import { ListingPanel } from "@/features/requirements/components/listing-panel";
import { customizationOpenersFor } from "@/features/requirements/openers";
import { aiConfigured } from "@/services/ai/client";
import {
  assistantViewer,
  getConversation,
  startOrResume,
} from "@/services/ai/conversation-service";
import { getProductDetail, screenshots } from "@/services/marketplace/detail";
import { resolveAiConfig } from "@/services/ai/settings";
import { pageMetadata } from "@/lib/seo";

/**
 * Per product, not one title for a thousand listings.
 *
 * It was a bare `{ title: "Request a customization" }` — the only public route
 * without `pageMetadata()`, so it had no description, no canonical and no Open
 * Graph, and every one of these pages shared a title. `generateMetadata` reads the
 * same cached `getProductDetail` the page does, so naming the product costs
 * nothing.
 */
export async function generateMetadata({
  params,
}: PageProps<"/customize/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductDetail(slug);
  if (!product) return { title: "Request a customization" };

  return pageMetadata({
    title: `Customise ${product.name}`,
    description: `Tell us what you'd want different about ${product.name}. We'll ask a few questions and turn it into a brief you can check before anything is sent.`,
    path: `/customize/${slug}`,
  });
}

/**
 * "This is almost what I need" — ticket 17, §15.
 *
 * ## A conversation instead of a requirements form
 *
 * §15 is explicit that the customer must not be shown a complex technical form.
 * The form still exists — it is the fallback inside `ReviewPanel` — but it is
 * what you reach when the assistant cannot help, not the front door.
 *
 * ## Why the conversation is created here and not on first message
 *
 * The interview needs a conversation id before the first turn, and for an
 * anonymous visitor that means an owner cookie. A Server Component cannot set
 * one — the first version of this called `ensureAnonymousKey()` here and every
 * visit 500'd with the exact error the function's own doc comment warns about.
 * `proxy.ts` mints it instead, onto the response *and* the forwarded request,
 * so this page sees it on the very first load.
 *
 * ## The page now shows the customer the thing they are changing
 *
 * It used to read `{ name, summary, currentVersionId }` off the product, put the
 * name in a heading, and pass nothing at all about it into the conversation. So a
 * customer was asked what they wanted different about software the page declined
 * to describe, and the three chips it offered instead — "I want to change how it
 * looks", "I need it to work differently", "I need it to connect to something
 * else" — were true of every product in the catalogue.
 *
 * `getProductDetail` is the read the product page itself uses: cached, tagged, and
 * carrying the features, taxonomy, media and staff-authored `suggestedAreas` that
 * both the `ListingPanel` and the opener chips need. One call replaces a
 * hand-rolled projection that was missing most of them.
 */
export default async function Page({ params, searchParams }: PageProps<"/customize/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;

  const product = await getProductDetail(slug);
  if (!product) notFound();

  const session = await getSession();
  /*
   * Reads the cookie whether or not there is a session, and claims anything
   * started before sign-in — see `assistantViewer`. `proxy.ts` mints the key
   * before the page runs, because a Server Component cannot set one.
   *
   * It also repairs `?from=` below: a conversation carried over from an
   * anonymous `/custom-software` interview used to fail `verifyCarried` after
   * sign-in, because the viewer no longer held the key that owned it.
   */
  const viewer = await assistantViewer(session);

  // No owner, no conversation — a crawler, since `proxy.ts` mints for everyone
  // else. `startOrResume` refuses to write one nobody could read, so this has
  // to branch rather than 500 an indexable page. See `/custom-software`.
  const owner = Boolean(viewer.userId || viewer.anonymousKey);

  /*
   * §20 — the version they own travels with the request.
   *
   * `software-card.tsx` appends `?version=` deliberately, with a comment saying
   * why, and this page read no `searchParams` at all — so it was dropped on every
   * arrival from My Software, and `currentVersionId` was selected and then never
   * used. Falling back to the current release is right for somebody arriving from
   * the listing, who does not own one yet.
   */
  const owned = single(query.version);
  const version =
    product.versions.find((candidate) => candidate.version === owned) ??
    product.versions.find((candidate) => candidate.isCurrent);

  // §24 — carried over from a custom-build conversation they walked away from.
  // A query parameter, so a claim: read it as the viewer, and drop it silently if
  // it is not theirs. `carriedCustomerMessages` checks again on every turn.
  const carriedFrom = await verifyCarried(single(query.from), viewer);

  const conversation = owner
    ? await startOrResume({
        contextType: "customization",
        productId: product.id,
        ...(version
          ? { productVersionId: version.id, productVersionNumber: version.version }
          : {}),
        ...(carriedFrom ? { carriedFromConversationId: carriedFrom } : {}),
        ...viewer,
      })
    : null;

  const config = await resolveAiConfig();
  const available = aiConfigured() && config.enabled;

  const shot = screenshots(product.media)[0];
  const listing = {
    name: product.name,
    slug: product.slug,
    summary: product.summary,
    ...(product.taxonomy.categories[0]?.name
      ? { category: product.taxonomy.categories[0].name }
      : {}),
    ...(product.taxonomy.industries[0]?.name
      ? { industry: product.taxonomy.industries[0].name }
      : {}),
    features: product.features,
    ...(shot ? { image: { url: shot.url, alt: shot.alt } } : {}),
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-10">
      <p className="text-subtle text-[12.5px]">
        <Link href={`/marketplace/${slug}`} className="underline underline-offset-4">
          ← Back to {product.name}
        </Link>
      </p>

      {!available && (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px]">
          Our assistant is unavailable at the moment, so write out what you need below and
          we&rsquo;ll pick it up from there.
        </p>
      )}

      {conversation === null ? (
        <>
          <h1 className="font-display text-[clamp(1.8rem,3.4vw,2.4rem)] tracking-[-0.03em]">
            Customise {product.name}
          </h1>
          <p className="border-border bg-surface rounded-xl border px-4 py-3.5 text-[13.5px]">
            <a href={`/customize/${slug}`} className="underline underline-offset-4">
              Start a conversation
            </a>{" "}
            and tell us what you&rsquo;d want different about {product.name}.
          </p>
          <ListingPanel listing={listing} />
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
          signInHref={`/login?next=${encodeURIComponent(`/customize/${slug}`)}`}
          startOverHref={`/customize/${slug}`}
          contextType="customization"
          initialCovered={conversation.coveredTopics}
          workspaceTitle={`Customising ${product.name}`}
          intro={
            <div className="flex max-w-[46rem] flex-col gap-3">
              <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                Request a change
              </p>
              <h1 className="font-display text-[clamp(1.8rem,3.4vw,2.4rem)] leading-[1.08] tracking-[-0.03em]">
                What would you change about {product.name}?
              </h1>
              <p className="text-muted-foreground text-[14.5px] leading-relaxed">
                Anything it already does can work differently, and anything it doesn&rsquo;t do
                can be added. Say it in your own words &mdash; we&rsquo;ll ask what we need to
                and you&rsquo;ll check the brief before it goes anywhere.
              </p>
            </div>
          }
          aside={<ListingPanel listing={listing} />}
          /*
           * Drawn from the product's own `suggestedAreas` where a vendor has filled
           * them in, and from the general set otherwise. Phrased as the customer's
           * wish rather than as an offer — `openers.ts` sets out why that limit
           * matters here specifically.
           */
          suggestions={
            conversation.messages.length === 0
              ? customizationOpenersFor(product.customization.suggestedAreas)
              : undefined
          }
        />
      )}
    </div>
  );
}

/** A query parameter that may legally arrive twice. First wins. */
function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Is this `?from=` a conversation the caller may actually read?
 *
 * The id is in a URL, so it is a claim about a conversation and not a fact about
 * one. `getConversation` throws `NotFoundError` rather than `Forbidden` for
 * somebody else's — deliberately, so a stranger cannot learn that an id is real —
 * and here that answer means the same as a malformed id: no carry-over, and a
 * page that works exactly as it would have without the parameter.
 *
 * Checked before it is written to the new conversation, so a bad claim never
 * becomes a stored link.
 */
async function verifyCarried(
  id: string | undefined,
  viewer: { userId?: string; organizationId?: string; anonymousKey?: string },
): Promise<string | undefined> {
  if (!id) return undefined;
  try {
    const source = await getConversation(id, viewer);
    return String(source._id);
  } catch {
    return undefined;
  }
}
