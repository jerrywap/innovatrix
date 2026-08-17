"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { signInWithGoogleAction } from "../actions";
import { FormError } from "./form-primitives";

/**
 * Sign in with Google — §75's optional OAuth.
 *
 * ## A form, not an onClick
 *
 * It posts to a server action, which redirects. That keeps the promise the rest
 * of this directory makes: every authentication control works with JavaScript
 * off. A `signIn.social()` click handler would have been fewer lines and the
 * only dead button on the page for a visitor without JS.
 *
 * ## Rendered only when the server says so
 *
 * `AUTH_GOOGLE_ENABLED` is server-only — `config/env.ts` imports `server-only`
 * and there is no client schema, deliberately. So the page reads it and passes
 * a boolean, the same way `/admin/settings/payments` passes `secretPresent`
 * rather than the secret. The action re-checks it: hiding a control is not a
 * permission check.
 *
 * ## Secondary, not primary
 *
 * Email and password stay the main path. §75 lists OAuth as optional, and the
 * visual weight should say the same thing.
 */
export function GoogleButton({ next, label }: { next?: string; label: string }) {
  const [state, formAction] = useActionState(signInWithGoogleAction, null);
  const failed = state && !state.ok ? state : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3" aria-hidden>
        <span className="bg-border h-px flex-1" />
        <span className="text-subtle font-mono text-[10px] tracking-[0.16em] uppercase">
          or
        </span>
        <span className="bg-border h-px flex-1" />
      </div>

      <FormError message={failed?.error} />

      <form action={formAction}>
        {/* Same reason as the password form: the action cannot see the page's
            query string, so `next` is carried through the form. */}
        {next && <input type="hidden" name="next" value={next} />}
        <Button label={label} />
      </form>
    </div>
  );
}

function Button({ label }: { label: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="border-border bg-surface hover:bg-surface-muted focus-visible:ring-ring flex w-full items-center justify-center gap-2.5 rounded-full border px-5 py-2.5 text-[14px] font-medium transition focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
    >
      <GoogleMark />
      {pending ? "Taking you to Google…" : label}
    </button>
  );
}

/** Google's mark, inline. `aria-hidden` — the button's text is its name. */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4 shrink-0" aria-hidden focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.96 10.71a5.41 5.41 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}
