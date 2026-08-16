"use client";

import { useEffect } from "react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    /*
     * `console.error`, and it stays that way — ticket 27.
     *
     * This is a Client Component, so `@/lib/logger` is unreachable: it imports
     * `server-only`, and rightly. The *server* side of this error is already
     * recorded by `onRequestError` in `instrumentation.ts`, with the same
     * `digest` the paragraph below asks the customer to quote — so nothing is
     * lost by this line being unstructured.
     *
     * What it buys is the browser console during development, and a hook for a
     * client-side error reporter (`Sentry.captureException`) when there is one.
     */
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-24">
      <div className="max-w-md text-center">
        <p className="font-mono text-xs tracking-[0.2em] text-neutral-400 uppercase">Error</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">
          Something went wrong on our side.
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-500">
          The issue has been logged. Try again, and if it keeps happening quote this reference
          to support.
        </p>
        {error.digest && (
          <p className="mt-4 font-mono text-xs text-neutral-400">{error.digest}</p>
        )}
        <button
          onClick={reset}
          className="mt-8 rounded-full bg-neutral-900 px-6 py-3 text-sm font-medium text-white transition hover:opacity-90 dark:bg-white dark:text-black"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
