"use client";

import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

const OPTIONS = [
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
] as const;

/**
 * "Have we hydrated yet?" as an external-store read rather than a
 * setState-in-an-effect. Same result, no cascading render — React uses the
 * server snapshot for the hydration pass and the client snapshot after.
 */
const noopSubscribe = () => () => {};
const useHydrated = () =>
  useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );

/**
 * Three-state control: light / system / dark.
 *
 * "System" is the default and is a real option rather than an implicit
 * starting state — a user who wants to follow their OS should be able to get
 * back to it after trying the other two.
 *
 * Renders a placeholder until mounted: the resolved theme isn't known during
 * SSR, and painting the wrong active pill then correcting it is a visible flash.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const mounted = useHydrated();

  if (!mounted) {
    return (
      <div
        className={`border-border bg-surface-muted h-9 w-[108px] rounded-full border ${className}`}
        aria-hidden
      />
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className={`border-border bg-surface-muted flex items-center gap-0.5 rounded-full border p-0.5 ${className}`}
    >
      {OPTIONS.map((option) => {
        const active = theme === option.value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            aria-label={option.label}
            title={option.label}
            onClick={() => setTheme(option.value)}
            className={`grid h-8 w-8 place-items-center rounded-full transition ${
              active
                ? "bg-surface text-foreground shadow-sm"
                : "text-subtle hover:text-foreground"
            }`}
          >
            <Icon name={option.value} />
          </button>
        );
      })}
    </div>
  );
}

function Icon({ name }: { name: "light" | "system" | "dark" }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "light") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
    );
  }
  if (name === "dark") {
    return (
      <svg {...common}>
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="2.5" y="4" width="19" height="13" rx="2.5" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}
