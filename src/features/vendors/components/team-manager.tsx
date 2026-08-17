"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import type { ActionResult } from "@/lib/action-result";
import { FormErrors } from "@/features/products/components/section-form";
import {
  inviteMemberAction,
  revokeInvitationAction,
  revokeMemberAction,
  transferOwnershipAction,
} from "../actions";

export interface TeamMemberView {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  isYou: boolean;
}

export interface PendingInviteView {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

/**
 * The vendor team screen — vendor ticket 03.
 *
 * ## Two roles, and why the form has no role picker
 *
 * `owner` and `member`, and there is exactly one owner. So an invitation is always
 * to `member` and the role field is a hidden input rather than a select: offering
 * a choice between one option is a decision nobody is making. Promotion happens
 * through **Transfer ownership**, which is one action — promote them, demote
 * yourself — because the intermediate states, two owners or none, are each a bug
 * somebody would have to clean up by hand.
 *
 * The four separate forms are deliberate. Each is a distinct server action with
 * its own guard, and one form with a `name="intent"` switch would put the choice
 * of what happens inside a request body.
 */
export function TeamManager({
  members,
  invitations,
}: {
  members: TeamMemberView[];
  invitations: PendingInviteView[];
}) {
  const [inviteState, inviteFormAction] = useActionState(inviteMemberAction, null);
  const inviteFailed = inviteState && !inviteState.ok ? inviteState : null;

  const others = members.filter((member) => member.status === "active" && !member.isYou);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Invite somebody</h2>
        <p className="text-muted-foreground text-[13px]">
          They will be able to work on your products, releases and support threads. They will
          not be able to see or change your payout account.
        </p>

        <form action={inviteFormAction} className="flex flex-col gap-3">
          {inviteFailed && (
            <FormErrors error={inviteFailed.error} fieldErrors={inviteFailed.fieldErrors} />
          )}

          <input type="hidden" name="role" value="member" />

          <div className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-56 flex-1 flex-col gap-1.5">
              <label htmlFor="invite-email" className="text-[13px] font-medium">
                Email address
              </label>
              <Input id="invite-email" name="email" type="email" required autoComplete="off" />
            </div>
            <Submit label="Send invitation" pendingLabel="Sending…" />
          </div>

          {inviteState?.ok === true && (
            <p role="status" className="text-[12.5px] text-emerald-700 dark:text-emerald-300">
              Invitation sent. It expires in 48 hours.
            </p>
          )}
        </form>
      </section>

      {invitations.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            Waiting to be accepted
          </h2>
          <ul className="border-border divide-border divide-y rounded-xl border">
            {invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
              >
                <span className="min-w-0 text-[13px]">
                  <span className="truncate">{invitation.email}</span>
                  <span className="text-subtle ml-2 font-mono text-[11px]">
                    expires {invitation.expiresAt}
                  </span>
                </span>
                <RowAction
                  action={revokeInvitationAction}
                  field="invitationId"
                  value={invitation.id}
                  label="Withdraw"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Who has access</h2>
        <ul className="border-border divide-border divide-y rounded-xl border">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[13.5px]">
                  {member.name}
                  {member.isYou && <span className="text-subtle"> — you</span>}
                </p>
                <p className="text-subtle truncate font-mono text-[11px]">{member.email}</p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={member.status} />
                <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  {member.role}
                </span>
                {member.status === "active" && member.role !== "owner" && (
                  <RowAction
                    action={revokeMemberAction}
                    field="memberId"
                    value={member.id}
                    label="Remove"
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
        <p className="text-subtle text-[12.5px]">
          The owner cannot be removed — transfer ownership first. An account with nobody in
          charge has a payout account nobody may change.
        </p>
      </section>

      {others.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Transfer ownership</h2>
          <p className="text-muted-foreground text-[13px]">
            They become the owner and you become a member. You will not be able to undo this
            yourself.
          </p>
          <ul className="flex flex-col gap-2">
            {others.map((member) => (
              <li key={member.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-48 flex-1 text-[13px]">{member.email}</span>
                <RowAction
                  action={transferOwnershipAction}
                  field="memberId"
                  value={member.id}
                  label={`Make owner`}
                  srSuffix={` — ${member.email}`}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

/**
 * One row, one form, one action.
 *
 * `srSuffix` extends the accessible name rather than replacing it: an
 * `aria-label` on a control with visible text must *contain* that text
 * (WCAG 2.5.3), so "Make owner" plus an `sr-only` span is correct where
 * `aria-label="Make jo@example.com the owner"` would not be.
 */
function RowAction({
  action,
  field,
  value,
  label,
  srSuffix,
}: {
  action: (
    previous: ActionResult<unknown> | null,
    formData: FormData,
  ) => Promise<ActionResult<unknown>>;
  field: string;
  value: string;
  label: string;
  srSuffix?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <input type="hidden" name={field} value={value} />
      <RowSubmit label={label} srSuffix={srSuffix} />
      {failed && <span className="text-[12px] text-[var(--danger)]">{failed.error}</span>}
    </form>
  );
}

function RowSubmit({ label, srSuffix }: { label: string; srSuffix?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Working…" : label}
      {srSuffix && <span className="sr-only">{srSuffix}</span>}
    </Button>
  );
}
