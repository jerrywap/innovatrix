import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description: "What we collect, why, and what we do with it.",
  path: "/privacy",
  type: "article",
});

/**
 * What the system actually stores — not a drafted privacy policy.
 *
 * ## Why this is facts rather than a notice
 *
 * A privacy notice is a legal instrument: it has to name a data controller,
 * cite a lawful basis per purpose, state retention periods and set out
 * statutory rights, and getting any of those wrong is worse than silence. I am
 * not the right author for that, and inventing it would produce a document that
 * *reads* binding and is not.
 *
 * What can be written accurately, and is the hard half of drafting one anyway,
 * is the inventory: every category of personal data this codebase actually
 * writes, and why. Each line below corresponds to a real collection or cookie —
 * `identity.ts`, `commerce.ts`, `requests.ts`, `system.ts`, and the four cookies
 * declared in `config/storefront.ts` and `services/ai/conversation-cookie.ts`.
 *
 * Keep it in step with the schema. A notice that has drifted from the code is
 * the failure mode that actually gets organisations fined.
 */

const COLLECTED = [
  {
    term: "Your account",
    detail:
      "Name, email address, password (stored hashed, never in readable form) and your language preference. Needed to sign you in and to know which organisation you belong to.",
  },
  {
    term: "Your organisation",
    detail:
      "Company name, billing address and tax identifier, plus who else is a member and what they are allowed to do. Used for invoicing and to keep one customer's records away from another's.",
  },
  {
    term: "Orders and payments",
    detail:
      "What you bought, when, in which currency and for how much, along with the billing details you entered at checkout. We record that a payment succeeded and its reference — we never see or store your card number. That stays with the payment provider.",
  },
  {
    term: "Licences and downloads",
    detail:
      "Which products you own, the licence keys issued to you, where they are activated, and a log of downloads. The log is what makes a paid download auditable rather than a guess.",
  },
  {
    term: "Conversations with the assistant",
    detail:
      "The full transcript of what you describe to the requirements assistant, including anything you type before signing up. It is kept so you can leave and come back to it, and so the person who eventually reads your request sees the context rather than a summary.",
  },
  {
    term: "Requests, quotes and messages",
    detail:
      "What you asked for, what we quoted, and the messages exchanged about it. Attachments you upload are stored with the request they belong to.",
  },
  {
    term: "Activity and audit records",
    detail:
      "Significant actions — a quote issued, a payment recorded, a permission changed — with who did them and when. Accepting a quote also records your IP address and browser, because acceptance is a commercial agreement and has to be evidenced.",
  },
];

const COOKIES = [
  {
    name: "Session",
    detail: "Keeps you signed in. Removed when you sign out.",
  },
  {
    name: "innovatrix_conv",
    detail:
      "A random identifier that lets a signed-out visitor return to an assistant conversation. It identifies the conversation, not you, and expires after 30 days.",
  },
  {
    name: "innovatrix_cart",
    detail: "Keeps a basket attached to you before you sign in.",
  },
  {
    name: "innovatrix_currency",
    detail: "Remembers which currency you chose. Set only when you choose one.",
  },
  {
    name: "innovatrix_rv",
    detail: "The products you recently looked at, so we can show them again.",
  },
];

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader title="Privacy" description="What we collect, why, and what we do with it." />

      <div className="border-border bg-surface-muted/50 mt-6 flex max-w-[74ch] gap-3 rounded-[22px] border p-5">
        <TriangleAlert className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-muted-foreground text-[13.5px] leading-relaxed">
          <span className="text-foreground font-medium">
            This is a description, not yet the formal notice.
          </span>{" "}
          It sets out honestly what the platform stores and why. The binding privacy notice —
          naming the data controller, the lawful basis for each purpose, retention periods and
          how to exercise your rights — is with our advisers and will replace this page before
          launch. If you need any of that detail sooner, ask us and we will answer directly.
        </p>
      </div>

      <section className="mt-14 flex flex-col gap-6">
        <div>
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            What we hold
          </div>
          <h2 className="font-display mt-3 max-w-[26ch] text-[clamp(1.4rem,3vw,2rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            Everything on this list, and nothing we have not listed.
          </h2>
        </div>

        <dl className="border-border divide-border bg-surface divide-y overflow-hidden rounded-[22px] border">
          {COLLECTED.map((item) => (
            <div key={item.term} className="flex flex-col gap-1 p-5 sm:flex-row sm:gap-6">
              <dt className="font-display w-full text-[14px] tracking-[-0.02em] sm:w-56 sm:shrink-0">
                {item.term}
              </dt>
              <dd className="text-muted-foreground text-[13.5px] leading-relaxed">
                {item.detail}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-16 flex flex-col gap-6">
        <div>
          <div className="text-subtle font-mono text-[10px] tracking-[0.2em] uppercase">
            Who else sees it
          </div>
          <h2 className="font-display mt-3 max-w-[28ch] text-[clamp(1.4rem,3vw,2rem)] leading-[1.05] font-semibold tracking-[-0.03em]">
            The services that make it work, and no one else.
          </h2>
        </div>

        <ul className="grid gap-4 sm:grid-cols-2">
          <Fact term="Payment providers">
            Card details are entered on the provider&rsquo;s own page and never reach us. They
            receive your email and the amount so they can take the payment.
          </Fact>
          <Fact term="The assistant&rsquo;s AI provider">
            What you type into the assistant is sent to a third-party model to generate the
            reply. Do not put passwords, card numbers or server credentials into it — there is a
            proper place for credentials and a chat window is not it.
          </Fact>
          <Fact term="Email and hosting">
            Providers who deliver our email and run our servers necessarily handle the data
            passing through them.
          </Fact>
          <Fact term="Nobody else">
            We do not sell personal data, and we do not share it for advertising.
          </Fact>
        </ul>
      </section>

      <section className="border-border bg-surface-muted/40 mt-16 flex flex-col gap-4 rounded-[26px] border p-7 lg:p-9">
        <h2 className="font-display max-w-[24ch] text-[clamp(1.3rem,2.6vw,1.8rem)] leading-[1.1] font-semibold tracking-[-0.03em]">
          Want a copy, or want it deleted?
        </h2>
        <p className="text-muted-foreground max-w-[58ch] text-[14px] leading-relaxed">
          Ask, and we will do it. Some records have to be kept regardless — an invoice is an
          accounting document and a licence is proof of what you bought — and we will tell you
          plainly which those are rather than quietly keeping them.
        </p>
        <Link
          href="/custom-software"
          className="border-border bg-surface hover:border-border-strong w-fit rounded-full border px-5 py-2.5 text-[13.5px] font-medium transition"
        >
          Get in touch
        </Link>
      </section>
    </div>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <li className="border-border bg-surface rounded-[22px] border p-5">
      <h3 className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">{term}</h3>
      <p className="text-muted-foreground mt-2 text-[13.5px] leading-relaxed">{children}</p>
    </li>
  );
}
