"use client";

import { useActionState } from "react";
import { completeAccountSetupAction } from "../actions";
import { FormError, SubmitButton } from "./form-primitives";

/**
 * The way out of "your account isn't set up yet".
 *
 * A form posting to a server action, for the reason the action's own docblock
 * gives: repairing this where it is noticed — in the dashboard layout, during
 * render — would be a GET that creates an organization, and Next prefetches
 * links on hover and in the viewport. A POST cannot be fired that way.
 *
 * A real form rather than an `onClick`, so it works with JavaScript off — the
 * same promise every other control in this directory makes.
 */
export function CompleteSetup() {
  const [state, formAction] = useActionState(completeAccountSetupAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <div className="flex flex-col gap-3">
      <FormError message={failed?.error} />
      <form action={formAction}>
        <SubmitButton>Finish setting up</SubmitButton>
      </form>
    </div>
  );
}
