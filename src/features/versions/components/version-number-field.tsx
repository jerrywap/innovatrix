"use client";

import { useState } from "react";
import { Minus, Plus, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { parseSemver } from "@/lib/semver";

/**
 * The version number, as three counters rather than a free-text box.
 *
 * ## Why
 *
 * `major.minor.patch` is a decision about *what changed*, and a text input asks
 * the vendor to encode that decision as punctuation. Three labelled counters ask
 * the question directly — "is this a fix, a feature, or a break?" — and cannot
 * produce `2.4` or `v2.4.0`, which `versionStringSchema` would then reject with a
 * message about semver.
 *
 * `nextPatch` already suggests the right starting point (a patch above the newest
 * release, or `1.0.0` for a first version), so the common case is now zero
 * keystrokes rather than five.
 *
 * ## The typed escape hatch is not optional
 *
 * A prerelease — `2.0.0-rc.1` — is legal, is what `nextPatch` deliberately
 * handles, and cannot be expressed by three counters. So there is a text mode,
 * and the counters are the default rather than the only way.
 *
 * One hidden input carries whichever mode is showing, so the server sees the same
 * field either way and `versionStringSchema` stays the authority on what is legal.
 */
export function VersionNumberField({ suggested }: { suggested: string }) {
  const parsed = parseSemver(suggested);

  const [parts, setParts] = useState(() => ({
    major: parsed?.major ?? 1,
    minor: parsed?.minor ?? 0,
    patch: parsed?.patch ?? 0,
  }));
  // A suggestion that is already a prerelease opens in text mode, because the
  // counters cannot represent it and silently dropping the `-rc.1` would be worse
  // than showing a box.
  const [typed, setTyped] = useState<string | null>(
    parsed && parsed.prerelease.length > 0 ? suggested : null,
  );

  const composed = `${parts.major}.${parts.minor}.${parts.patch}`;
  const value = typed ?? composed;

  const bump = (key: keyof typeof parts, delta: number) =>
    setParts((current) => {
      const next = Math.max(0, current[key] + delta);
      // Bumping a major resets what it supersedes, which is what semver means and
      // what a vendor would otherwise have to do by hand in two more clicks.
      if (key === "major") return { major: next, minor: 0, patch: 0 };
      if (key === "minor") return { ...current, minor: next, patch: 0 };
      return { ...current, patch: next };
    });

  return (
    <div className="flex flex-col gap-2">
      <input type="hidden" name="version" value={value} />

      {typed === null ? (
        <div className="flex flex-wrap items-end gap-2">
          {(
            [
              ["major", "Major", "Breaks something"],
              ["minor", "Minor", "Adds something"],
              ["patch", "Patch", "Fixes something"],
            ] as const
          ).map(([key, label, hint]) => (
            <div key={key} className="flex flex-col gap-1">
              <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
                {label}
              </span>
              <div className="border-border flex items-center rounded-lg border">
                <Stepper
                  onClick={() => bump(key, -1)}
                  disabled={parts[key] === 0}
                  label={`One fewer ${label.toLowerCase()}`}
                >
                  <Minus className="size-3" aria-hidden />
                </Stepper>
                <span className="w-9 text-center font-mono text-[15px] tabular-nums">
                  {parts[key]}
                </span>
                <Stepper onClick={() => bump(key, 1)} label={`One more ${label.toLowerCase()}`}>
                  <Plus className="size-3" aria-hidden />
                </Stepper>
              </div>
              <span className="text-subtle text-[11px]">{hint}</span>
            </div>
          ))}

          <div className="flex flex-col gap-1 pb-5">
            <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
              Result
            </span>
            <span className="font-mono text-[15px] font-medium tabular-nums">{composed}</span>
          </div>

          <button
            type="button"
            onClick={() => setTyped(composed)}
            className="text-muted-foreground hover:text-foreground mb-6 flex items-center gap-1.5 text-[12px] underline underline-offset-4"
          >
            <Pencil className="size-3" aria-hidden />
            Type it instead
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder="2.0.0-rc.1"
            aria-label="Version number"
            className="max-w-48 font-mono text-[13px]"
          />
          <button
            type="button"
            onClick={() => setTyped(null)}
            className="text-muted-foreground hover:text-foreground text-[12px] underline underline-offset-4"
          >
            Use the counters
          </button>
        </div>
      )}
    </div>
  );
}

function Stepper({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="hover:bg-surface-muted flex size-7 items-center justify-center transition disabled:opacity-30"
    >
      {children}
    </button>
  );
}
