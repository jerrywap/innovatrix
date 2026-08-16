"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { StatusBadge } from "@/components/status-badge";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { FormErrors } from "@/features/products/components/section-form";
import { cn } from "@/lib/utils";
import type { TaxonomyKind } from "@/lib/db/enums";
import { createTaxonomyAction, deleteTaxonomyAction, updateTaxonomyAction } from "../actions";

/**
 * The taxonomy editor for one kind.
 *
 * A client island because it is a list of inline-editable rows, and the whole
 * value of that is not navigating away to change a sort order.
 *
 * The delete control carries its usage count. "This is in use" without a number
 * leaves someone hunting; "4 products use this" tells them the size of the job
 * before they start it. The service refuses regardless — this is only so the
 * refusal is not a surprise.
 */

export interface TaxonomyRow {
  id: string;
  kind: TaxonomyKind;
  name: string;
  slug: string;
  description?: string;
  icon?: string;
  sortOrder: number;
  isActive: boolean;
  /** How many products reference it. Drives the delete affordance. */
  usageCount: number;
}

export function TaxonomyManager({
  kind,
  rows,
  canManage,
}: {
  kind: TaxonomyKind;
  rows: readonly TaxonomyRow[];
  canManage: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="border-border bg-surface divide-border divide-y rounded-xl border">
        {rows.length === 0 && (
          <p className="text-muted-foreground px-4 py-6 text-[13.5px]">Nothing here yet.</p>
        )}

        {rows.map((row) =>
          editing === row.id ? (
            <TaxonomyForm key={row.id} kind={kind} row={row} onDone={() => setEditing(null)} />
          ) : (
            <TaxonomyRowView
              key={row.id}
              row={row}
              canManage={canManage}
              onEdit={() => setEditing(row.id)}
            />
          ),
        )}

        {adding && <TaxonomyForm kind={kind} onDone={() => setAdding(false)} />}
      </div>

      {canManage && !adding && (
        <Button variant="outline" size="sm" className="w-fit" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" aria-hidden />
          Add
        </Button>
      )}
    </div>
  );
}

function TaxonomyRowView({
  row,
  canManage,
  onEdit,
}: {
  row: TaxonomyRow;
  canManage: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("text-[14px] font-medium", !row.isActive && "text-subtle")}>
            {row.name}
          </span>
          <code className="text-subtle font-mono text-[11.5px]">{row.slug}</code>
          {!row.isActive && <StatusBadge status="archived" label="Inactive" />}
        </div>
        {row.description && (
          <p className="text-muted-foreground mt-0.5 truncate text-[12.5px]">
            {row.description}
          </p>
        )}
      </div>

      <span className="text-subtle shrink-0 text-[12px] tabular-nums">
        {row.usageCount} {row.usageCount === 1 ? "product" : "products"}
      </span>

      {canManage && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onEdit}
            aria-label={`Edit ${row.name}`}
          >
            <Pencil className="size-3.5" aria-hidden />
          </Button>

          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${row.name}`}
                // Disabled when in use, and the dialog would refuse anyway —
                // the service is the authority, this is only the courtesy.
                disabled={row.usageCount > 0}
              >
                <Trash2 className="size-3.5" aria-hidden />
              </Button>
            }
            title={`Delete "${row.name}"?`}
            description={
              row.usageCount > 0
                ? `${row.usageCount} product${row.usageCount === 1 ? "" : "s"} still use this. Reassign them first, or set it inactive instead.`
                : "This cannot be undone. Setting it inactive hides it without removing it."
            }
            confirmLabel="Delete"
            destructive
            action={() => deleteTaxonomyAction(row.id)}
          />
        </div>
      )}
    </div>
  );
}

function TaxonomyForm({
  kind,
  row,
  onDone,
}: {
  kind: TaxonomyKind;
  row?: TaxonomyRow;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(
    row ? updateTaxonomyAction : createTaxonomyAction,
    null,
  );
  const failed = state && !state.ok ? state : null;

  // A successful save closes the row. Rendering during a state transition is
  // fine here because the parent owns the open/closed flag.
  if (state?.ok) {
    queueMicrotask(onDone);
  }

  return (
    <form action={formAction} className="bg-surface-muted/40 flex flex-col gap-3 px-4 py-3.5">
      <input type="hidden" name="kind" value={kind} />
      {row && <input type="hidden" name="id" value={row.id} />}

      {failed && <FormErrors error={failed.error} fieldErrors={failed.fieldErrors} />}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">Name</span>
          <Input name="name" defaultValue={row?.name} required maxLength={80} />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">
            Address <span className="text-subtle font-normal">(from the name if blank)</span>
          </span>
          <Input
            name="slug"
            defaultValue={row?.slug}
            placeholder="crm"
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={80}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12.5px] font-medium">
          Description{" "}
          <span className="text-subtle font-normal">
            — used as the intro copy on this category&rsquo;s landing page
          </span>
        </span>
        <Textarea name="description" defaultValue={row?.description} rows={2} maxLength={500} />
      </label>

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-[12.5px] font-medium">Order</span>
          <Input
            name="sortOrder"
            type="number"
            min={0}
            max={9999}
            defaultValue={row?.sortOrder ?? 0}
            className="w-24"
          />
        </label>

        <label className="flex items-center gap-2 pb-2">
          <Checkbox name="isActive" defaultChecked={row?.isActive ?? true} value="on" />
          <span className="text-[13px]">Offered in the marketplace</span>
        </label>

        <div className="ml-auto flex items-center gap-2 pb-1">
          <SaveButton />
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            <X className="size-3.5" aria-hidden />
            Cancel
          </Button>
        </div>
      </div>
    </form>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Saving…" : "Save"}
    </Button>
  );
}
