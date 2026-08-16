"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff } from "lucide-react";

/**
 * A demo credential with a copy button.
 *
 * A client island because the clipboard is a browser API and there is no
 * server-rendered equivalent. Small on purpose: it receives a string and owns
 * nothing else.
 *
 * ## Masked by default, and the mask is cosmetic
 *
 * The value is already in this browser — the server decided the viewer was
 * entitled to it before rendering. Masking is shoulder-surfing protection for
 * someone demoing on a shared screen, not a security control, and pretending
 * otherwise would be worse than not having it.
 */
export function CopyField({
  label,
  value,
  secret,
}: {
  label: string;
  value: string;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  return (
    <div className="border-border bg-background flex items-center gap-2 rounded-lg border px-2.5 py-1.5">
      <span className="text-subtle shrink-0 font-mono text-[10px] tracking-[0.12em] uppercase">
        {label}
      </span>

      <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">
        {revealed ? value : "•".repeat(Math.min(value.length, 14))}
      </span>

      {secret && (
        <button
          type="button"
          onClick={() => setRevealed((current) => !current)}
          className="text-subtle hover:text-foreground shrink-0 p-0.5"
        >
          {revealed ? (
            <EyeOff className="size-3.5" aria-hidden />
          ) : (
            <Eye className="size-3.5" aria-hidden />
          )}
          <span className="sr-only">
            {revealed ? `Hide the ${label}` : `Show the ${label}`}
          </span>
        </button>
      )}

      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          } catch {
            // `writeText` rejects without a secure context or the permission.
            // Selecting the text still works, so this is not worth an alert.
          }
        }}
        className="text-subtle hover:text-foreground shrink-0 p-0.5"
      >
        {copied ? (
          <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        ) : (
          <Copy className="size-3.5" aria-hidden />
        )}
        <span className="sr-only">Copy the {label}</span>
      </button>

      <output aria-live="polite" className="sr-only">
        {copied ? `${label} copied` : ""}
      </output>
    </div>
  );
}
