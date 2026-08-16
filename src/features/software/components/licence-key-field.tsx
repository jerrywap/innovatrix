"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { maskLicenceKey } from "@/lib/licence-key";

/**
 * The key, masked with a reveal and a copy button.
 *
 * A client island because the clipboard is a browser API and the mask toggles.
 *
 * ## The mask is not a security control
 *
 * The key is already in this browser — the server decided the viewer is in the
 * organisation that bought it before rendering. Masking helps somebody
 * screen-sharing; calling it protection would be theatre.
 */
export function LicenceKeyField({ licenceKey }: { licenceKey: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  return (
    <div className="border-border bg-background flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5">
      <code className="min-w-0 flex-1 font-mono text-[14px] tracking-[0.04em] break-all">
        {revealed ? licenceKey : maskLicenceKey(licenceKey)}
      </code>

      <button
        type="button"
        onClick={() => setRevealed((current) => !current)}
        className="text-subtle hover:text-foreground shrink-0 p-1"
      >
        {revealed ? (
          <EyeOff className="size-4" aria-hidden />
        ) : (
          <Eye className="size-4" aria-hidden />
        )}
        <span className="sr-only">
          {revealed ? "Hide the licence key" : "Show the licence key"}
        </span>
      </button>

      <button
        type="button"
        onClick={async () => {
          try {
            // Always the full key, whether or not it is revealed — copying a
            // row of bullets is a bug report waiting to happen.
            await navigator.clipboard.writeText(licenceKey);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            // `writeText` rejects without a secure context. Selecting the text
            // still works, so this is not worth an alert.
          }
        }}
        className="text-subtle hover:text-foreground shrink-0 p-1"
      >
        {copied ? (
          <Check className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Copy className="size-4" aria-hidden />
        )}
        <span className="sr-only">Copy the licence key</span>
      </button>

      <output aria-live="polite" className="sr-only">
        {copied ? "Licence key copied" : ""}
      </output>
    </div>
  );
}
