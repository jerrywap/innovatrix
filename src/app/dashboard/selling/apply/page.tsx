import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { serverEnv } from "@/config/env";
import { requireUser, requireVendorOrNull } from "@/lib/auth/dal";
import { VENDOR_AGREEMENT_VERSION } from "@/services/vendors/vendor-service";
import { ApplyForm } from "@/features/vendors/components/apply-form";
import { ResendVerification } from "@/features/auth/components/resend-verification";
import { ApplyAside } from "@/features/vendors/components/apply-aside";
import { STEPS } from "@/features/vendors/sell-data";

export const metadata: Metadata = { title: "Sell on CoSetup" };

/**
 * Applying to become a vendor — vendor ticket 01.
 *
 * **Authenticated, not public.** The applicant is already a signed-up user: they
 * have an email the platform has verified, a user id for the owner membership to
 * hang off, and a session to audit the agreement acceptance against. A public form
 * would collect an identity the platform already holds and then have to reconcile
 * the two. `/sell` is the public page in front of this, and it is content.
 *
 * ## An unverified email is explained here, not thrown
 *
 * This page used `requireVerifiedUser()`, which throws `ForbiddenError`. The docblock argued that
 * was fine because "the dashboard already nags about it" — and it was wrong, in a way that only
 * shows up when somebody with an unverified address actually opens the page.
 *
 * What they got: **"Something went wrong. That didn't load. Trying again usually works."** The
 * segment boundary decides between a refusal and a fault by matching the error message against
 * `/permission|access|staff account|don't have/`, and "Please confirm your email address before
 * completing a purchase" matches none of it — so a refusal rendered as a fault, advising a retry
 * that could never work, and never mentioning email at all.
 *
 * Two things were wrong with the throw even if the copy had been right: the message is about
 * *completing a purchase*, which is not what this page is (`requireVerifiedUser` was written for
 * checkout, §75), and the fix belongs to the reader — so the screen has to hand them the button
 * rather than sending them to look for it.
 *
 * So: `requireUser()`, then the verification state is a *branch*, with the existing
 * `ResendVerification` control inline. `serverEnv()` is read here because the requirement is
 * configurable — a seeded demo environment turns it off, and this page must not gate on something
 * the platform is not enforcing.
 */
export default async function Page() {
  const user = await requireUser();

  if (serverEnv().AUTH_REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <PageHeader
          title="Confirm your email first"
          description="One step before you can apply to sell."
          breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sell" }]}
        />

        <div className="border-border bg-surface flex flex-col gap-3 rounded-[22px] border p-5 lg:p-6">
          <p className="text-[13.5px] leading-relaxed">
            We sent a link to <span className="font-mono text-[13px]">{user.email}</span>.
            Confirming it is what lets us record your acceptance of the vendor agreement against
            a real address — which is the record a copyright claim or a dispute is weighed
            against later, so it cannot be an address nobody has checked.
          </p>
          <p className="text-muted-foreground text-[13px]">
            Nothing else about your account is affected, and you can keep browsing and buying
            meanwhile.
          </p>
          <ResendVerification />
        </div>
      </div>
    );
  }

  // Already a vendor? The application is behind them. Sending them to the
  // overview is the useful answer; a refusal would be technically correct and
  // unhelpful.
  const existing = await requireVendorOrNull();
  if (existing) redirect("/dashboard/selling");

  return (
    <div className="flex w-full max-w-[1040px] flex-col gap-7">
      <PageHeader
        title="Sell on CoSetup"
        description="Tell us who you are and what you build. Somebody reads every application."
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sell" }]}
        // `PageHeader`'s unused slot, earning its keep: applying is step one of four,
        // and saying so is the difference between a form and a form with a horizon.
        actions={
          <span className="border-border bg-surface-muted/60 text-muted-foreground rounded-full border px-3 py-1.5 font-mono text-[10px] tracking-[0.14em] uppercase">
            Step 1 of 4
          </span>
        }
      />

      {/*
        The journey, above the form.
        
        The same four steps `/sell` sets out, from the same constant so the two
        cannot drift — a signed-in applicant who came straight here via the nav has
        not seen that page, and this is the context the nav item promises they get.
      */}
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className={
              index === 0
                ? "border-signal/40 bg-signal-soft/50 flex items-center gap-2.5 rounded-xl border px-3.5 py-3"
                : "border-border bg-surface-muted/30 flex items-center gap-2.5 rounded-xl border px-3.5 py-3"
            }
          >
            <span
              className={
                index === 0
                  ? "text-signal-text font-mono text-[10px] tabular-nums"
                  : "text-subtle font-mono text-[10px] tabular-nums"
              }
            >
              {String(index + 1).padStart(2, "0")}
            </span>
            <span
              className={
                index === 0 ? "text-[13px] font-medium" : "text-muted-foreground text-[13px]"
              }
            >
              {step.title}
            </span>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
        {/*
          The form, in a card. Untouched inside — seven field names, the Zod schema,
          `SectionForm`'s manual dispatch, the native country select and the
          agreement gate's hidden input all behave exactly as before. Only the box
          around it is new.
        */}
        <div className="border-border bg-surface rounded-[22px] border p-5 lg:col-span-7 lg:p-7">
          <ApplyForm defaultEmail={user.email} agreementVersion={VENDOR_AGREEMENT_VERSION} />
        </div>

        {/* After the form in DOM order, so it reads last on a phone. */}
        <div className="lg:col-span-5">
          <ApplyAside />
        </div>
      </div>
    </div>
  );
}
