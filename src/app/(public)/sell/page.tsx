import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Sell your software",
  description:
    "List your own software on the CoSetup marketplace. We handle checkout, licensing and delivery; you keep building.",
  path: "/sell",
});

/**
 * The public front door for vendors — vendor ticket 01.
 *
 * **Content, not a form.** The application itself is authenticated and lives at
 * `/dashboard/selling/apply`, because the applicant is already a signed-up user:
 * they have a verified email, a user id for the owner membership to hang off, and
 * a session to audit the agreement acceptance against. A public form would collect
 * an identity the platform already holds and then have to reconcile the two.
 *
 * So this page's only job is to explain and then point at sign-in. A signed-out
 * visitor clicking through lands on `/register?next=…` and comes back.
 */
export default function Page() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-3">
        <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
          For developers
        </p>
        <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.03em]">
          Sell your software on CoSetup
        </h1>
        <p className="text-muted-foreground text-[15px] leading-relaxed">
          You wrote it. We handle the checkout, the licence keys, the delivery and the invoices,
          and take a share of each sale. Your customers download from us, so your uptime is
          never their problem.
        </p>
      </header>

      <section className="flex flex-col gap-5">
        <Step
          n="1"
          title="Apply"
          body="Tell us who you are and what you build. Somebody reads every application — this is not an automatic sign-up."
        />
        <Step
          n="2"
          title="Verify your identity"
          body="A government ID and a proof of address. This is what lets you list a product. Business details come later, and only matter when we pay you."
        />
        <Step
          n="3"
          title="List your first product"
          body="The same tools our own catalogue is built with. A reviewer checks it before it goes on sale, and tells you what to change if it isn't ready."
        />
        <Step
          n="4"
          title="Get paid"
          body="Earnings accrue as customers buy. Once they clear, they're paid out on a schedule you can see."
        />
      </section>

      <div className="border-border flex flex-wrap items-center gap-3 border-t pt-6">
        <Button asChild>
          {/*
            Straight to the authenticated form. A signed-out visitor is bounced to
            `/login`, which returns them here afterwards — one round trip, rather
            than a second application form that only exists to be signed out.
          */}
          <Link href="/dashboard/selling/apply">Apply to sell</Link>
        </Button>
        <Button asChild variant="outline">
          {/* The terms, before applying rather than as a checkbox somebody clicks past. */}
          <Link href="/terms/vendor">Read the vendor agreement</Link>
        </Button>
        <p className="text-subtle text-[12.5px]">
          You&rsquo;ll need an CoSetup account. Signing up is free.
        </p>
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="flex gap-4">
      <span
        className="bg-surface-muted text-subtle grid size-7 shrink-0 place-items-center rounded-full font-mono text-[11px]"
        aria-hidden
      >
        {n}
      </span>
      <div>
        <h2 className="font-display text-[16px] tracking-[-0.02em]">{title}</h2>
        <p className="text-muted-foreground mt-1 text-[13.5px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
