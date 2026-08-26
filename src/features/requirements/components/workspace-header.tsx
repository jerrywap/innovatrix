import { DiscoveryProgress } from "./discovery-progress";
import { DISCOVERY_STEPS, type DiscoveryStage } from "../stage";

/**
 * What the intro collapses into, once the conversation is under way.
 *
 * ## The problem it solves is scrolling, and it was a real one
 *
 * The invitation is about 400px of heading, paragraph, reassurances and steps.
 * Useful once. From the second answer onwards it sits between the top of the page
 * and the conversation, so every glance at the thread starts with reading the
 * pitch again — and on a phone the composer is below the fold for the whole
 * interview.
 *
 * This is the same information compressed to a line and a disclosure. The title
 * says which of the two doors you came through; the progress row says where you
 * are; the `<details>` holds the three steps for anyone who wants them back.
 *
 * ## `<details>` rather than state
 *
 * It works with JavaScript disabled, it is keyboard-operable and screen-reader
 * announced without an `aria-expanded` to keep in sync, and the browser remembers
 * nothing between navigations — which is right, because re-opening it is one
 * click and defaulting it open would undo the whole point.
 */
export function WorkspaceHeader({ title, stage }: { title: string; stage: DiscoveryStage }) {
  return (
    <div className="border-border flex flex-col gap-3 border-b pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <h1 className="font-display text-[19px] tracking-[-0.02em]">{title}</h1>
        <DiscoveryProgress stage={stage} />
      </div>

      <details className="group">
        <summary className="text-subtle hover:text-foreground w-fit cursor-pointer list-none text-[12px] underline underline-offset-4">
          {/* Two labels rather than a rotating chevron: the word is the state, and
              it reads correctly when the arrow is the only thing a stylesheet
              fails to load. */}
          <span className="group-open:hidden">How this works</span>
          <span className="hidden group-open:inline">Hide</span>
        </summary>

        <ol className="mt-3 grid gap-x-8 gap-y-3 sm:grid-cols-3">
          {DISCOVERY_STEPS.map((step, index) => (
            <li key={step.id} className="flex flex-col gap-0.5">
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] tabular-nums">
                {String(index + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] font-medium">{step.label}</span>
              <span className="text-muted-foreground text-[12.5px] leading-relaxed">
                {step.detail}
              </span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
