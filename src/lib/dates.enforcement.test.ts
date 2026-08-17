import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Nobody may write their own date formatter again.
 *
 * ## Why this is a test rather than a note in AGENTS.md
 *
 * It already *was* a note in AGENTS.md — "Absolute dates, not '3 days ago'" —
 * and the rule was honoured in `components/timeline.tsx`, which no file
 * imported, while a four-line `isoDay()` was copy-pasted into six view modules
 * and truncated every timestamp to a day. The convention was written down and
 * the codebase disagreed with it in nineteen places.
 *
 * That is the same lesson `theme-tokens.test.ts` and `loading-boundaries.test.ts`
 * exist for: a convention only holds if something fails when it is broken.
 *
 * ## What is banned, and why each one
 *
 * - `toISOString().slice(0, 10)` — throws the time away silently. It is the
 *   exact line that was duplicated. `toDateInputValue()` is the legitimate use,
 *   named so that reaching for it to *display* something looks wrong.
 * - `toLocaleDateString` / `toLocaleTimeString` — no fixed locale and no
 *   explicit zone, so the server and the browser can render the same instant
 *   differently and React complains at hydration.
 * - `new Intl.DateTimeFormat` outside this module — the thing `lib/dates.ts`
 *   exists to own.
 */

const BANNED: ReadonlyArray<{ pattern: RegExp; instead: string }> = [
  {
    pattern: /toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/,
    instead: "toDateInputValue() from @/lib/dates",
  },
  { pattern: /\.toLocaleDateString\(/, instead: "formatDay() from @/lib/dates" },
  { pattern: /\.toLocaleTimeString\(/, instead: "formatDateTime() from @/lib/dates" },
  { pattern: /new Intl\.DateTimeFormat\(/, instead: "formatDay()/formatDateTime()" },
];

/** The module that is allowed to do it, and the tests that assert about it. */
const EXEMPT = [
  join("src", "lib", "dates.ts"),
  join("src", "lib", "dates.test.ts"),
  join("src", "lib", "dates.enforcement.test.ts"),
  // Renders `at` through its own `Intl` formatter, which is the one place a
  // component may: it receives a `Date` and owns the `<time>` element.
  join("src", "components", "timeline.tsx"),
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("date formatting lives in one module", () => {
  it("has no hand-rolled formatter outside lib/dates.ts", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles("src")) {
      const rel = relative(process.cwd(), file);
      if (EXEMPT.some((exempt) => rel.endsWith(exempt))) continue;

      const source = readFileSync(file, "utf8");
      for (const { pattern, instead } of BANNED) {
        if (pattern.test(source)) offenders.push(`${rel} — use ${instead}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
