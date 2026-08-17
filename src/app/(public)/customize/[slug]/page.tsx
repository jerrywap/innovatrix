import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { getSession } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Product } from "@/lib/db/models/catalog";
import { Assistant } from "@/features/requirements/components/assistant";
import { aiConfigured } from "@/services/ai/client";
import { readAnonymousKey, startOrResume } from "@/services/ai/conversation-service";
import { resolveAiConfig } from "@/services/ai/settings";

export const metadata: Metadata = { title: "Request a customization" };

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
 */
export default async function Page({ params }: PageProps<"/customize/[slug]">) {
  const { slug } = await params;

  await connectToDatabase();
  const product = await Product.findOne({ slug, status: "published", deletedAt: null })
    .select({ name: 1, summary: 1, currentVersionId: 1 })
    .lean<{ _id: unknown; name: string; summary?: string; currentVersionId?: unknown }>();

  if (!product) notFound();

  const session = await getSession();
  // Read-only. `proxy.ts` mints this before the page runs — a Server
  // Component cannot set a cookie, and the first version of this tried to.
  const anonymousKey = session?.user.id ? undefined : await readAnonymousKey();

  // No owner, no conversation — a crawler, since `proxy.ts` mints for everyone
  // else. `startOrResume` refuses to write one nobody could read, so this has
  // to branch rather than 500 an indexable page. See `/custom-software`.
  const owner = Boolean(session?.user.id || anonymousKey);

  const conversation = owner
    ? await startOrResume({
        contextType: "customization",
        productId: String(product._id),
        ...(session?.user.id ? { userId: session.user.id } : {}),
        ...(session?.activeOrganizationId
          ? { organizationId: session.activeOrganizationId }
          : {}),
        ...(anonymousKey ? { anonymousKey } : {}),
      })
    : null;

  const config = await resolveAiConfig();
  const available = aiConfigured() && config.enabled;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10">
      <PageHeader
        title={`Customise ${product.name}`}
        description="Tell us what you'd want different. No forms — we'll ask, you answer, and you check the summary before anything is sent."
      />

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
        <p className="border-border bg-surface rounded-xl border px-4 py-3.5 text-[13.5px]">
          <a href={`/customize/${slug}`} className="underline underline-offset-4">
            Start a conversation
          </a>{" "}
          and tell us what you&rsquo;d want different about {product.name}.
        </p>
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
          {...(conversation.submittedRequestId
            ? { submitted: { reference: "your request" } }
            : {})}
          suggestions={
            conversation.messages.length === 0
              ? [
                  "I want to change how it looks",
                  "I need it to work differently",
                  "I need it to connect to something else",
                ]
              : undefined
          }
        />
      )}
    </div>
  );
}
