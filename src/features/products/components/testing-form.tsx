"use client";

import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { FieldGroup, SectionForm } from "./section-form";
import { saveTestingAction } from "../actions";
import { TESTING_CHECKLIST_STATUSES } from "@/lib/db/enums";
import type { AdminProductView } from "@/services/catalog/product-view";
import { formatDateTime } from "@/lib/dates";

type ChecklistRow = AdminProductView["testingChecklist"][number];

const STATUS_LABEL: Record<string, string> = {
  pending: "Not checked",
  pass: "Pass",
  fail: "Fail",
  na: "N/A",
};

/**
 * The §47 internal testing checklist.
 *
 * ## Two rules the form has to make visible, because they refuse a publish
 *
 * 1. **`n/a` needs a note.** Otherwise it is indistinguishable from clicking
 *    through, which is how a checklist becomes theatre. `readiness.ts` enforces
 *    it; this says so at the point of choosing, so the refusal is not a surprise
 *    two steps later.
 * 2. **Nothing may be left pending.** An untested product and a fully-passed one
 *    must not look the same.
 *
 * The items themselves are fixed — they come from `DEFAULT_TESTING_CHECKLIST`,
 * merged on read so a product created before an item existed is still asked
 * about it. There is no "add your own check", because a checklist somebody can
 * shorten is not a gate.
 */
export function TestingForm({
  product,
  checklist,
  nextHref,
}: {
  product: AdminProductView;
  checklist: readonly ChecklistRow[];
  nextHref: string;
}) {
  const outstanding = checklist.filter((row) => row.status === "pending").length;

  return (
    <SectionForm action={saveTestingAction} productId={product.id} nextHref={nextHref}>
      <FieldGroup
        title="Before this can be marked ready"
        description={
          outstanding > 0
            ? `${outstanding} of ${checklist.length} still to check. Every item has to pass, or be marked N/A with a note.`
            : "Everything has been looked at. N/A still needs a note to count."
        }
      >
        <div className="border-border divide-border bg-surface divide-y rounded-xl border">
          {checklist.map((row, index) => (
            <ChecklistRowFields key={row.item} row={row} index={index} />
          ))}
        </div>
      </FieldGroup>
    </SectionForm>
  );
}

function ChecklistRowFields({ row, index }: { row: ChecklistRow; index: number }) {
  const needsNote = row.status === "na" && !row.notes?.trim();

  return (
    <div className="flex flex-col gap-2 p-3">
      {/* The item name is fixed — sent as a hidden field so the server matches
          rows by name rather than by position, which reordering would break. */}
      <input type="hidden" name={`testingChecklist[${index}][item]`} value={row.item} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[13.5px] font-medium">{row.item}</span>
        <div className="flex items-center gap-2">
          {row.checkedAt && (
            <span className="text-subtle font-mono text-[10.5px]">
              {formatDateTime(row.checkedAt)}
            </span>
          )}
          <StatusBadge status={row.status} />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {TESTING_CHECKLIST_STATUSES.map((status) => (
          <label
            key={status}
            className="border-border hover:bg-surface-muted flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[12.5px] has-checked:border-[var(--signal)] has-checked:bg-[var(--signal)]/8"
          >
            <input
              type="radio"
              name={`testingChecklist[${index}][status]`}
              value={status}
              defaultChecked={row.status === status}
              className="accent-[var(--signal)]"
            />
            {STATUS_LABEL[status] ?? status}
          </label>
        ))}
      </div>

      <Input
        name={`testingChecklist[${index}][notes]`}
        defaultValue={row.notes ?? ""}
        maxLength={500}
        placeholder={
          needsNote
            ? "N/A needs a reason — this one is blocking publish"
            : "Notes (required if N/A)"
        }
        aria-label={`Notes for ${row.item}`}
        className={needsNote ? "border-[var(--danger)] text-[13px]" : "text-[13px]"}
      />
    </div>
  );
}
