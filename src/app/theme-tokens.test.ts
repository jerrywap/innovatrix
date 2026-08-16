import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The dark theme, checked structurally rather than by eye.
 *
 * "Dark mode is complete" is the kind of claim that is true the day it's made
 * and quietly false a month later, because the failure is invisible until
 * someone with the other theme opens the one screen that uses the new token.
 * The shape of that failure is always the same: **a colour defined only in
 * `:root`, with a literal value, and never redeclared for dark.**
 *
 * So this parses `globals.css` and enforces the rule the token layer is built
 * on: a token either
 *
 *   a) holds a **literal** — and must then be declared in *both* themes, or
 *   b) is an **alias** (`var(--something)`) — and needs no dark declaration,
 *      because it resolves through whatever the literal underneath resolves to.
 *
 * That is also what makes re-running `shadcn init` survivable: it writes
 * literals, and a literal it adds to `:root` alone fails here.
 */

const css = readFileSync(fileURLToPath(new URL("./globals.css", import.meta.url)), "utf8");

/**
 * Comments stripped. Without this, a comment *describing* a forbidden pattern
 * trips the check that forbids it — which is exactly what happened first time:
 * the note explaining that `--font-sans: var(--font-sans)` was removed contains
 * that string.
 */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations inside a top-level block whose selector is exactly `selector`. */
function tokensIn(selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start === -1) throw new Error(`No "${selector}" block in globals.css`);

  // Walk braces so a nested block can't end the scan early.
  let depth = 0;
  let index = css.indexOf("{", start);
  const from = index;
  for (; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }

  const body = css.slice(from + 1, index);
  const tokens = new Map<string, string>();
  for (const match of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    tokens.set(match[1]!, match[2]!.trim());
  }
  return tokens;
}

const isAlias = (value: string) => /^var\(--[a-z0-9-]+\)$/i.test(value);
/** Non-colour tokens — geometry and shadow inputs — needn't vary by theme. */
const NON_COLOUR = new Set(["--radius"]);

describe("theme tokens", () => {
  const light = tokensIn(":root");
  const dark = tokensIn(".dark");

  it("declares a dark value for every literal colour in :root", () => {
    const missing = [...light.entries()]
      .filter(([name, value]) => !isAlias(value) && !NON_COLOUR.has(name))
      .filter(([name]) => !dark.has(name))
      .map(([name]) => name);

    expect(
      missing,
      "these hold a literal in :root and are never redeclared for dark — " +
        "the dark theme will show the light value",
    ).toEqual([]);
  });

  it("declares nothing in .dark that :root doesn't also declare", () => {
    // A token that exists only in dark is a hole in the *light* theme, which is
    // the failure mode nobody tests for because they develop in dark.
    const orphans = [...dark.keys()].filter((name) => !light.has(name));
    expect(orphans, "defined only for dark").toEqual([]);
  });

  it("keeps every shadcn token as an alias, never a literal", () => {
    // The whole defence against `shadcn init` overwriting the palette. See the
    // comment at the top of the token layer.
    const shadcnTokens = [
      "--card",
      "--card-foreground",
      "--popover",
      "--popover-foreground",
      "--primary",
      "--primary-foreground",
      "--secondary",
      "--secondary-foreground",
      "--muted",
      "--accent",
      "--accent-foreground",
      "--input",
      "--sidebar",
      "--sidebar-foreground",
      "--sidebar-primary",
      "--sidebar-accent",
      "--sidebar-border",
      "--sidebar-ring",
    ];

    const literals = shadcnTokens.filter((name) => {
      const value = light.get(name);
      return value !== undefined && !isAlias(value);
    });

    expect(
      literals,
      "a shadcn token holding a literal has stopped tracking the Meridian palette",
    ).toEqual([]);
  });

  it("maps --primary to the brand and --muted to a surface", () => {
    // shadcn's `--muted` is a surface; ours used to be the text colour. Getting
    // this backwards is what made the rename to `--muted-foreground` necessary.
    expect(light.get("--primary")).toBe("var(--signal)");
    expect(light.get("--muted")).toBe("var(--surface-muted)");
    expect(light.get("--card")).toBe("var(--surface)");
  });

  it("keeps the radius pinned to Meridian's geometry", () => {
    // `shadcn init` resets this to 0.625rem, which halves every corner.
    expect(light.get("--radius")).toBe("1rem");
  });

  it("points font-sans at Archivo rather than a second typeface", () => {
    // `init` adds Geist and a self-referential `--font-sans: var(--font-sans)`.
    expect(code).toContain("--font-sans: var(--font-archivo)");
    expect(code).not.toContain("--font-sans: var(--font-sans)");
    expect(code).not.toContain("Geist");
  });

  it("uses a dark variant that matches the .dark element itself", () => {
    // shadcn writes `&:is(.dark *)`, which matches *descendants* only — so
    // `dark:` utilities on <html>, where next-themes puts the class, silently
    // stop working.
    expect(code).toContain("@custom-variant dark (&:where(.dark, .dark *))");
    expect(code).not.toContain("(&:is(.dark *))");
  });
});
