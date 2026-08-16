"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { Route } from "next";
import { Loader2, UserPlus } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { assignableStaffAction, bulkAssignAction } from "../actions";
import type { QueueRow } from "../queues";

/**
 * A work queue, with bulk assign — §32.
 *
 * ## The assign bar appears only when something is selected
 *
 * A permanently-visible bar with a disabled button is a control that spends
 * most of its life saying "no". Appearing on selection also makes the count
 * meaningful: "Assign 4 requests" is a sentence, "Assign" is not.
 *
 * ## The staff list is fetched on demand
 *
 * Rendering it with the page would put every staff member's name into the RSC
 * payload of a screen that is mostly read without ever assigning anything.
 */
export function QueueTable({ rows, queueKey }: { rows: QueueRow[]; queueKey: string }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [staff, setStaff] = useState<Array<{ id: string; name: string }>>([]);
  const [state, submit] = useActionState(bulkAssignAction, null);

  useEffect(() => {
    if (selected.size === 0 || staff.length > 0) return;
    void assignableStaffAction().then((result) => {
      if (result.ok) setStaff(result.data);
    });
  }, [selected.size, staff.length]);

  /*
   * Cleared after a successful assign: those rows have moved, and leaving them
   * ticked invites a second assign of work that is already gone.
   *
   * Adjusted *during render* rather than in an effect. `setState` inside an
   * effect that watches `state` schedules a second render pass after the first
   * has painted — React's `set-state-in-effect` rule flags it, and the visible
   * symptom is the selection bar flashing before it clears. Comparing against
   * the last handled result is the documented way to derive state from a
   * changed value.
   */
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) setSelected(new Set());
  }

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <form action={submit} className="flex flex-col gap-3">
      <input type="hidden" name="queueKey" value={queueKey} />
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="requestIds" value={id} />
      ))}

      {selected.size > 0 && (
        <div className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-xl border p-3">
          <span className="flex items-center gap-1.5 text-[13px]">
            <UserPlus className="text-subtle size-4" aria-hidden />
            {selected.size} selected
          </span>

          <select
            name="assigneeUserId"
            required
            className="border-border bg-background rounded-lg border px-3 py-1.5 text-[12.5px]"
          >
            <option value="">Assign to…</option>
            {staff.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>

          <input
            name="note"
            maxLength={300}
            placeholder="Why (optional)"
            className="border-border bg-background min-w-0 flex-1 rounded-lg border px-3 py-1.5 text-[12.5px]"
          />

          <Assign />

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-subtle hover:text-foreground text-[12.5px]"
          >
            Clear
          </button>
        </div>
      )}

      {state?.ok && (
        <p role="status" className="text-subtle text-[12.5px]">
          Assigned {state.data.assigned}
          {state.data.skipped > 0
            ? ` · ${state.data.skipped} had already moved and were left alone`
            : ""}
          .
        </p>
      )}
      {state?.ok === false && (
        <p className="text-[12.5px] text-[var(--danger)]">{state.error}</p>
      )}

      <div className="border-border overflow-x-auto rounded-xl border">
        <table className="w-full min-w-[48rem] text-left">
          <thead className="border-border bg-surface-muted border-b">
            <tr className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
              <th className="px-3 py-2.5 font-normal">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(next) =>
                    setSelected(next === true ? new Set(rows.map((row) => row.id)) : new Set())
                  }
                  aria-label="Select every row"
                />
              </th>
              <th className="px-4 py-2.5 font-normal">Reference</th>
              <th className="px-4 py-2.5 font-normal">Customer</th>
              <th className="px-4 py-2.5 font-normal">Subject</th>
              <th className="px-4 py-2.5 font-normal">Status</th>
              <th className="px-4 py-2.5 font-normal">Assignee</th>
              <th className="px-4 py-2.5 font-normal">Waiting</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-surface-muted">
                <td className="px-3 py-2.5">
                  <Checkbox
                    checked={selected.has(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Select ${row.reference}`}
                  />
                </td>
                <td className="px-4 py-2.5">
                  <Link
                    href={`/staff/requests/${row.reference}` as Route}
                    className="font-mono text-[12px] underline underline-offset-4"
                  >
                    {row.reference}
                  </Link>
                </td>
                <td className="px-4 py-2.5 text-[13px]">{row.organizationName}</td>
                <td className="max-w-[22rem] truncate px-4 py-2.5 text-[13px]">{row.title}</td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={row.status} />
                </td>
                <td className="text-muted-foreground px-4 py-2.5 text-[12.5px]">
                  {row.assigneeName ?? "—"}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={
                      row.ageDays >= 7
                        ? "font-mono text-[12px] text-amber-700 dark:text-amber-400"
                        : "text-subtle font-mono text-[12px]"
                    }
                  >
                    {row.ageDays === 0 ? "today" : `${row.ageDays}d`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}

function Assign() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-fit">
      {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      Assign
    </Button>
  );
}
