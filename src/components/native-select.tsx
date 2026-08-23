import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * A real `<select>`, styled to sit beside the Radix one.
 *
 * ## Why a second select component exists
 *
 * Two things the Radix `Select` cannot do, both of which are requirements rather
 * than preferences:
 *
 * 1. **It cannot represent "nothing chosen".** `SelectItem` rejects `value=""`,
 *    because Radix reserves the empty string for clearing the value. So a field
 *    labelled "(optional)" had no option meaning *optional*: once a type was
 *    picked there was no way back, and on a fresh draft the hidden native select
 *    submitted `""` — which the validator then refused as "Not a valid id",
 *    making the whole step unsaveable. A native `<option value="">` says it
 *    plainly.
 * 2. **It cannot survive a form reset.** Radix's form primitives answer a `reset`
 *    event by restoring a ref captured on first render, which is how a save came
 *    to wipe the value it had just stored (see `section-form.tsx`). A native
 *    control is reset by the browser to its *current* `defaultValue`, which React
 *    has already updated — so it is immune by construction rather than by
 *    arrangement.
 *
 * It also closes a smaller hole for free: with no active options at all, the
 * Radix version renders an empty popover with nothing to click, while this one
 * still offers its placeholder option.
 *
 * ## Why `components/` and not `components/ui/`
 *
 * `components/ui/` is shadcn's directory and `shadcn init` merges into it in
 * place. A hand-written file there is a file that can be overwritten by a tool
 * run, silently, at some later date.
 *
 * Not a client component: it has no state and no handlers of its own. `onChange`
 * arrives from whichever client component renders it.
 *
 * ## The two className props
 *
 * `appearance-none` means the arrow has to be drawn, which means a positioning
 * context, which means a wrapper. Width therefore belongs on the **wrapper** — a
 * width on the select inside a shrink-wrapped parent either resolves against
 * fit-content (so `w-full` collapses to the content) or leaves the arrow pinned to
 * the wrapper's right edge rather than the control's. So `containerClassName`
 * takes the sizing and `className` takes everything else.
 */
export function NativeSelect({
  className,
  containerClassName,
  children,
  ...props
}: React.ComponentProps<"select"> & { containerClassName?: string }) {
  return (
    <div className={cn("relative w-fit", containerClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          // Deliberately the `SelectTrigger` vocabulary — border, radius, ring
          // and height — so the two kinds of select do not read as two kinds of
          // field. `pr-8` leaves room for the chevron drawn below.
          "border-input dark:bg-input/30 dark:hover:bg-input/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 h-8 w-full appearance-none rounded-lg border bg-transparent py-1 pr-8 pl-2.5 text-sm transition-colors outline-none focus-visible:ring-3 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      {/*
        `appearance-none` removes the platform arrow, so one is drawn back.
        `pointer-events-none` matters: without it the icon swallows the click on
        the right-hand end of the control, which is exactly where people aim.
      */}
      <ChevronDownIcon
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2"
        aria-hidden
      />
    </div>
  );
}
