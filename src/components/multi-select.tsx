"use client";

import { useId, useMemo, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  id: string;
  name: string;
}

/**
 * A searchable, multiple-choice picker that submits inside a plain `<form>`.
 *
 * ## Why this exists, when a checkbox list was the deliberate choice
 *
 * `classification-form.tsx` argued — correctly — that a plain checkbox list works
 * with no JavaScript at all and that a searchable multi-select would be "more code
 * and less reliable". What it did not know is that **a search box over an
 * uncontrolled checkbox list is itself a data-loss bug**: a box hidden by the
 * filter unmounts, an unmounted checkbox submits nothing, and the save writes an
 * empty array over selections the person can no longer see. Adding a filter to the
 * old control was never an option; the selection had to move out of the DOM first.
 *
 * Which is why this holds it in React state and emits hidden inputs. That has a
 * second, larger benefit: a DOM `form.reset()` does not touch React state, so this
 * control is immune by construction to the reset bug documented in
 * `section-form.tsx` — the one that was silently wiping the taxonomy on every save.
 *
 * ## Why a popover and not a dropdown menu
 *
 * `DropdownMenuCheckboxItem` looks like the obvious fit and cannot work: a Radix
 * menu owns the keyboard (arrows move between items, printable keys do typeahead),
 * so the search field cannot be typed into, and `menu` is not a legal parent for a
 * textbox.
 *
 * ## Selection is intersected with `options`
 *
 * Only ids still present in `options` are submitted or shown as chips. That is what
 * keeps catalogue scoping working: flipping a product from `script` to `template`
 * narrows the vocabulary, and without the intersection the form would go on
 * submitting script terms the server is required to refuse.
 *
 * ## Keyboard: the combobox pattern, not a tab stop per option
 *
 * Focus never leaves the search field — `aria-activedescendant` moves a *virtual*
 * cursor through the list. With forty categories, the alternative is forty tab
 * stops between the field and the next control, and a visible focus ring that
 * appears to be in two places at once.
 *
 * Props are plain data only: this is a client component rendered by a Server
 * Component, and a function prop across that boundary is a 500 (see `AGENTS.md`).
 */
export function MultiSelect({
  name,
  label,
  options,
  defaultSelected,
  emptyLabel = "None defined yet — add some under Taxonomies.",
}: {
  /** The form field name. Emitted once per selected id, as a repeated field. */
  name: string;
  /** Names the control for a screen reader — e.g. "Categories". */
  label: string;
  options: readonly MultiSelectOption[];
  defaultSelected: readonly string[];
  emptyLabel?: string;
}) {
  const [selected, setSelected] = useState<readonly string[]>(defaultSelected);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  /** The virtual cursor — an option id, not an index, so filtering cannot move it. */
  const [activeId, setActiveId] = useState<string | null>(null);

  const listboxId = useId();
  const optionDomId = (id: string) => `${listboxId}-${id}`;

  // See "Selection is intersected with `options`" above. Order follows `options`
  // so the chips read in the same sequence as the list, not in click order.
  const chosen = useMemo(
    () => options.filter((option) => selected.includes(option.id)),
    [options, selected],
  );

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.name.toLowerCase().includes(needle));
  }, [options, query]);

  if (options.length === 0) {
    return <p className="text-subtle text-[13px]">{emptyLabel}</p>;
  }

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  const moveTo = (index: number) => {
    const next = matches[Math.max(0, Math.min(index, matches.length - 1))];
    if (next) setActiveId(next.id);
  };

  const activeIndex = matches.findIndex((option) => option.id === activeId);

  return (
    <div className="flex flex-col gap-2">
      {/*
        Outside the popover on purpose. Radix portals `PopoverContent` to the end
        of the document — out of the `<form>` — so a hidden input rendered in there
        would submit nothing at all, which is the same silent-empty-array failure
        this control exists to avoid.
      */}
      {chosen.map((option) => (
        <input key={option.id} type="hidden" name={name} value={option.id} />
      ))}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          // A stale query would make the list look empty the next time it opens.
          if (!next) setQuery("");
        }}
      >
        {/*
          No `aria-haspopup` override. Radix's default is `dialog`, which is the
          accurate one — the popup holds a search field *and* a list, so calling it
          a listbox describes only half of it. The listbox role belongs on the `ul`
          inside, where it is true.
        */}
        <PopoverTrigger className="border-input dark:bg-input/30 hover:bg-surface-muted focus-visible:border-ring focus-visible:ring-ring/50 flex h-8 w-full items-center justify-between gap-2 rounded-lg border bg-transparent px-2.5 text-sm transition-colors outline-none focus-visible:ring-3 sm:w-[280px]">
          <span className={chosen.length === 0 ? "text-muted-foreground" : undefined}>
            {chosen.length === 0
              ? `Choose ${label.toLowerCase()}`
              : `${chosen.length} selected`}
            {/*
              What "3 selected" is three of. `FieldGroup` renders the heading as an
              `<h2>`, not a `<label>`, so nothing associates it with this button and
              out of context its name would be a bare number.

              Appended rather than replacing the visible text via `aria-label`, so
              the accessible name still *contains* what is on screen — WCAG 2.5.3,
              the same rule `account-menu.tsx` follows for its initials.
            */}
            <span className="sr-only"> {label}</span>
          </span>
          <ChevronDown className="text-muted-foreground size-4 shrink-0" aria-hidden />
        </PopoverTrigger>

        <PopoverContent className="w-[280px] p-0">
          {/*
            Radix moves focus to the first focusable child when the popover opens,
            which is this field — so typing works immediately with no `autoFocus`
            and no effect.
          */}
          <div className="border-border border-b p-1.5">
            <input
              type="text"
              role="combobox"
              aria-expanded
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-label={`Search ${label.toLowerCase()}`}
              {...(activeId && activeIndex >= 0
                ? { "aria-activedescendant": optionDomId(activeId) }
                : {})}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                // The cursor is an id, so a filter that hides it leaves it
                // dangling — clear it rather than pointing at nothing.
                setActiveId(null);
              }}
              onKeyDown={(event) => {
                switch (event.key) {
                  case "ArrowDown":
                    moveTo(activeIndex < 0 ? 0 : activeIndex + 1);
                    break;
                  case "ArrowUp":
                    moveTo(activeIndex < 0 ? matches.length - 1 : activeIndex - 1);
                    break;
                  case "Home":
                    moveTo(0);
                    break;
                  case "End":
                    moveTo(matches.length - 1);
                    break;
                  case "Enter": {
                    // Never a submit. The content is portalled out of the form so
                    // it could not submit anyway, but relying on that would make
                    // this depend on where Radix happens to mount.
                    const target = activeIndex >= 0 ? matches[activeIndex] : matches[0];
                    if (target) toggle(target.id);
                    break;
                  }
                  case "Backspace":
                    // Only with an empty field, or it would delete a chip
                    // mid-word instead of a character.
                    if (query === "" && chosen.length > 0) {
                      toggle(chosen[chosen.length - 1]!.id);
                    } else {
                      return;
                    }
                    break;
                  default:
                    return;
                }
                event.preventDefault();
              }}
              placeholder="Search…"
              className="placeholder:text-muted-foreground h-7 w-full bg-transparent px-1.5 text-sm outline-none"
            />
          </div>

          <ul
            id={listboxId}
            role="listbox"
            aria-multiselectable
            aria-label={label}
            className="max-h-[240px] overflow-y-auto p-1"
          >
            {matches.length === 0 && (
              <li className="text-muted-foreground px-2 py-1.5 text-[13px]">
                Nothing matches &ldquo;{query.trim()}&rdquo;.
              </li>
            )}

            {matches.map((option) => {
              const isSelected = selected.includes(option.id);
              return (
                <li
                  key={option.id}
                  id={optionDomId(option.id)}
                  role="option"
                  aria-selected={isSelected}
                  /*
                    A `<li role="option">` and not a `<button>`: focus stays in the
                    search field, so these must not be tab stops. Pointer users get
                    `onClick`; keyboard users get `aria-activedescendant`.
                  */
                  onClick={() => toggle(option.id)}
                  onPointerMove={() => setActiveId(option.id)}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 text-sm",
                    option.id === activeId && "bg-accent text-accent-foreground",
                  )}
                >
                  <Check
                    className={cn("size-3.5 shrink-0", !isSelected && "opacity-0")}
                    aria-hidden
                  />
                  {option.name}
                </li>
              );
            })}
          </ul>
        </PopoverContent>
      </Popover>

      {/*
        The count, for a screen reader.

        Selection lives in the chips below, which a sighted user sees appear. A
        virtual cursor moving through a list announces the option, not how many are
        now chosen, so without this the running total is only available by tabbing
        out and reading every chip.
      */}
      <span role="status" className="sr-only">
        {chosen.length} of {options.length} {label.toLowerCase()} selected
      </span>

      {chosen.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {chosen.map((option) => (
            <li key={option.id}>
              {/*
                Chips outside the trigger, not inside it: a button inside a button
                is invalid, and putting the only way to deselect behind an
                interaction means the selection is not visible at rest.
              */}
              <button
                type="button"
                onClick={() => toggle(option.id)}
                className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-ring flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12.5px] focus-visible:ring-2 focus-visible:outline-none"
              >
                {option.name}
                <X className="size-3" aria-hidden />
                <span className="sr-only">— remove</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
