"use client";

import { useActionState } from "react";
import { acceptInviteAction } from "../actions";
import { FormError, SubmitButton } from "./form-primitives";

export function AcceptInviteForm({ invitationId }: { invitationId: string }) {
  const [state, formAction] = useActionState(acceptInviteAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={failed?.error} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton>Accept invitation</SubmitButton>
    </form>
  );
}
