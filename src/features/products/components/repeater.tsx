"use client";

import { useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A list of rows a person can add to and remove from.
 *
 * ## Field names carry the index
 *
 * Each row renders its fields as `features[0][title]`, and
 * `parseNestedFormData` turns that back into an array of objects. That is not
 * cosmetic. The alternative — repeating the plain name `features.title` on
 * every row — collapses to two parallel arrays, and a row with one field left
 * blank shifts everything after it: row three silently takes row two's value.
 * Nothing throws, and nobody notices until a customer sees the wrong price
 * against the wrong currency.
 *
 * Indices need not stay contiguous; removing the middle row leaves a gap, and
 * `parseNestedFormData` closes it on the way in because Zod arrays reject
 * sparse input.
 *
 * ## Ordering
 *
 * Move up/down buttons rather than drag-and-drop. Drag is nicer with a mouse
 * and unusable with a keyboard, and this is a form an administrator may well be
 * tabbing through.
 */

export interface RepeaterProps<T> {
  initial: readonly T[];
  blank: () => T;
  /** Renders one row's inputs. `index` must be used in every field name. */
  row: (item: T, index: number) => React.ReactNode;
  addLabel: string;
  /** Shown instead of rows when there are none. */
  emptyLabel?: string;
  max?: number;
  reorderable?: boolean;
  className?: string;
}

export function Repeater<T>({
  initial,
  blank,
  row,
  addLabel,
  emptyLabel,
  max = 40,
  reorderable = false,
  className,
}: RepeaterProps<T>) {
  /*
   * Note there is no hidden "this list is empty" marker. A repeater cleared to
   * nothing submits no fields, `parseNestedFormData` therefore omits the key,
   * and every section schema defaults that to `[]` — so clearing the last row
   * does clear the stored list. Worth stating, because the absence looks like
   * an oversight.
   */
  // Keys, not indices, for React's reconciliation — removing row 1 with
  // index keys makes React reuse row 2's DOM node and its uncontrolled input
  // values move up with it.
  const [rows, setRows] = useState(() =>
    initial.map((item, index) => ({ key: `initial-${index}`, item })),
  );
  const [nextKey, setNextKey] = useState(initial.length);

  const add = () => {
    setRows((current) => [...current, { key: `added-${nextKey}`, item: blank() }]);
    setNextKey((n) => n + 1);
  };

  const remove = (key: string) => setRows((current) => current.filter((r) => r.key !== key));

  const move = (index: number, delta: number) =>
    setRows((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved!);
      return next;
    });

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {rows.length === 0 && emptyLabel && (
        <p className="text-subtle text-[13px]">{emptyLabel}</p>
      )}

      {rows.map((entry, index) => (
        <div
          key={entry.key}
          className="border-border bg-surface flex items-start gap-2 rounded-xl border p-3"
        >
          {reorderable && (
            <div className="flex shrink-0 flex-col pt-1">
              <button
                type="button"
                onClick={() => move(index, -1)}
                disabled={index === 0}
                aria-label={`Move up`}
                className="text-subtle hover:text-foreground disabled:opacity-30"
              >
                <GripVertical className="size-3.5 rotate-90" aria-hidden />
              </button>
            </div>
          )}

          <div className="min-w-0 flex-1">{row(entry.item, index)}</div>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => remove(entry.key)}
            aria-label="Remove this row"
            className="shrink-0"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </Button>
        </div>
      ))}

      {rows.length < max && (
        <Button type="button" variant="outline" size="sm" onClick={add} className="w-fit">
          <Plus className="size-3.5" aria-hidden />
          {addLabel}
        </Button>
      )}
    </div>
  );
}
