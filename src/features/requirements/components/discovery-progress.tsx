import { Check } from "lucide-react";
import { DISCOVERY_STEPS, stepStates, type DiscoveryStage } from "../stage";

/**
 * Where the customer is in the three steps.
 *
 * ## It replaces three cards that stopped being useful after one click
 *
 * The process used to be explained by three bordered cards, each with an icon
 * tile, a heading and two lines of copy — about 180px of vertical space that was
 * information the first time and furniture every time after. They did disappear
 * once the conversation started, and nothing took their place, so the page went
 * from over-explaining to saying nothing about where you were.
 *
 * The same three steps as a progress row cost one line and keep earning it,
 * because the state changes: the customer can see that answering questions is
 * step one of three and that a person reads it at the end. §34's "the brief does
 * not become a price" is a promise this makes structurally — "we scope and quote"
 * is drawn as a step nobody has reached yet.
 *
 * ## Numbers because it is a sequence
 *
 * `01 / 02 / 03` is load-bearing here rather than decorative: these steps happen
 * in order and you cannot be at the second without having done the first. The
 * numbering treatment is `services.tsx`'s, so it reads as the same system.
 *
 * ## Compact on a phone by dropping the labels, not the steps
 *
 * Below `sm` the connectors and long labels go and the short ones stay, so three
 * steps still fit on one line at 390px without a horizontal scroll. Hiding a step
 * would be worse than hiding its description — the count is the reassurance.
 */
export function DiscoveryProgress({ stage }: { stage: DiscoveryStage }) {
  const states = stepStates(stage);

  return (
    <ol
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 sm:gap-x-3"
      /*
       * The current step is announced through its own `aria-current`, so the list
       * needs no label of its own — but a screen reader arriving here cold has no
       * idea what the three numbers are counting.
       */
      aria-label="Progress through your request"
    >
      {DISCOVERY_STEPS.map((step, index) => {
        const state = states[index]!;

        return (
          <li key={step.id} className="flex items-center gap-2 sm:gap-3">
            <span
              className="flex items-center gap-1.5"
              {...(state === "active" ? { "aria-current": "step" as const } : {})}
            >
              {state === "done" ? (
                <span className="bg-signal-soft grid size-4 place-items-center rounded-full">
                  <Check className="text-signal-text size-2.5" strokeWidth={3} aria-hidden />
                  {/* The tick is the only thing distinguishing done from todo for
                      a sighted reader, so the word travels for everyone else. */}
                  <span className="sr-only">Done:</span>
                </span>
              ) : (
                <span
                  className={
                    state === "active"
                      ? "text-signal-text font-mono text-[9.5px] tracking-[0.16em] tabular-nums"
                      : "text-subtle font-mono text-[9.5px] tracking-[0.16em] tabular-nums"
                  }
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              )}

              <span
                className={
                  state === "todo" ? "text-subtle text-[12.5px]" : "text-[12.5px] font-medium"
                }
              >
                <span className="sm:hidden">{step.short}</span>
                <span className="hidden sm:inline">{step.label}</span>
              </span>
            </span>

            {index < DISCOVERY_STEPS.length - 1 && (
              <span className="bg-border hidden h-px w-6 sm:block lg:w-10" aria-hidden />
            )}
          </li>
        );
      })}
    </ol>
  );
}
