"use client";

import { useActionState } from "react";
import { FormError, SubmitButton } from "@/features/auth/components/form-primitives";
import { acceptVendorInviteAction } from "../actions";

/**
 * The vendor half of the accept page — vendor ticket 03.
 *
 * Identical in shape to `auth/components/accept-invite-form.tsx`, and reusing its
 * primitives, because the two forms sit on the same page and must not look or
 * behave differently. Only the action underneath differs.
 */
export function AcceptVendorInviteForm({ invitationId }: { invitationId: string }) {
  const [state, formAction] = useActionState(acceptVendorInviteAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError message={failed?.error} />
      <input type="hidden" name="invitationId" value={invitationId} />
      <SubmitButton>Accept invitation</SubmitButton>
    </form>
  );
}
