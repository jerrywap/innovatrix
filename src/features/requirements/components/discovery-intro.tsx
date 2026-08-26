import { DISCOVERY_STEPS } from "../stage";

/**
 * The invitation — stage A only.
 *
 * ## The heading had to stop starting from our word for it
 *
 * It was "Build custom software", which is the category we file this under. The
 * customer arriving here does not have a software project; they have vans whose
 * MOT dates live in somebody's head, or registrations coming in over WhatsApp.
 * "Custom software" is a phrase that makes a small business owner assume this is
 * not for them, and the page then spent a paragraph arguing otherwise.
 *
 * "Tell us what you need" asks for the one thing they can definitely supply. The
 * sentence under it was already the best writing on the page and is unchanged.
 *
 * ## The reassurances are true, which is the only reason they are here
 *
 * Discovery is free — nothing on this path takes payment, and submitting creates
 * a request that a person quotes. No technical knowledge is needed — the prompt
 * bans our vocabulary unless the customer introduces it first. Neither claims a
 * turnaround, because §40 forbids inventing one and we do not have one.
 */
export function DiscoveryIntro() {
  return (
    <div className="flex max-w-[46rem] flex-col gap-4">
      <p className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        Have something in mind?
      </p>

      <h1 className="font-display text-[clamp(2rem,4.2vw,2.75rem)] leading-[1.06] tracking-[-0.03em]">
        Tell us what you need.
      </h1>

      <p className="text-muted-foreground max-w-[38rem] text-[15px] leading-relaxed">
        You don&rsquo;t need a technical specification. Describe the problem, the idea or the
        job in your own words &mdash; we&rsquo;ll ask a few questions and turn it into something
        we can build.
      </p>

      <ul className="text-subtle flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px]">
        {[
          "Free discovery",
          "No technical knowledge needed",
          "A person reads every request",
        ].map((claim) => (
          <li key={claim} className="flex items-center gap-1.5">
            <span className="bg-signal size-1 rounded-full" aria-hidden />
            {claim}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The three steps, below the composer.
 *
 * They were three bordered cards at the *top*, competing with the headline for
 * the first thing you read — and losing, because "01 You describe the problem" is
 * not more interesting than being asked what you need. Separate from
 * `DiscoveryIntro` so the composer can sit between them: the invitation, the box
 * to type in, then the answer to the question somebody has once they have read it
 * — what happens if I do this.
 */
export function DiscoverySteps() {
  return (
    <ol className="border-border grid gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-3">
      {DISCOVERY_STEPS.map((step, index) => (
        <li key={step.id} className="flex flex-col gap-1">
          <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] tabular-nums">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-[13.5px] font-medium">{step.label}</span>
          <span className="text-muted-foreground text-[12.5px] leading-relaxed">
            {step.detail}
          </span>
        </li>
      ))}
    </ol>
  );
}
