import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Our spec section numbers must not reach a screen.
 *
 * `§37`, `§48`, `§102` are references into the internal technical document, and this
 * codebase is dense with them on purpose: a comment that says *which rule* a line obeys
 * is worth far more than one restating what the line does. That is a conversation between
 * people who have the document.
 *
 * A **user** does not have it. Five had leaked into visible copy — a reviewer's hint
 * reading "Never sent to the vendor and never in their payload — §37.", and four wizard
 * field-group descriptions a *vendor* reads on their own product ("the things sold
 * alongside (§49)"). A reader who cannot resolve the reference is left with the
 * impression that something was pasted from somewhere they were not meant to see, and
 * they are right.
 *
 * ## What this test can and cannot see
 *
 * It is a text scan, not a parse: it strips comments and then looks for `§`. That catches
 * the whole class cheaply and has no false negatives that matter — a section number in a
 * string, a template literal or JSX text is exactly what it is looking for, wherever it
 * sits.
 *
 * Test files keep theirs. A `describe("§84 …")` names the rule under test for whoever
 * reads the failure, and no user sees a test name.
 */

const ROOTS = ["app", "features", "components"].map((dir) => join(process.cwd(), "src", dir));

/*
 * There is no exemption list, and there should not be one.
 *
 * `/concepts` used to be exempt — five unbuilt landing-page directions that argued
 * their case in spec terms for an internal audience. It was deleted with the CoSetup
 * rebrand, because the brand sheet answered the question it existed to ask, and the
 * exemption went with it. Anything shipping a user journey has no claim on one.
 */

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(path) && !/\.(test|spec)\.tsx?$/.test(path)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Block comments, line comments and JSX comment expressions.
 *
 * Order matters: `{/* … *\/}` is a block comment wrapped in braces, so removing block
 * comments first leaves a harmless `{}` behind rather than an unmatched brace.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("internal spec references stay in the comments", () => {
  it("never puts a § section number where a user can read it", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const relativePath = relative(process.cwd(), file);

        const code = withoutComments(readFileSync(file, "utf8"));
        if (!code.includes("§")) continue;

        // Name the line, so the failure is a place to go rather than a fact to look up.
        for (const [index, line] of code.split("\n").entries()) {
          if (line.includes("§"))
            offenders.push(`${relativePath}:${index + 1} — ${line.trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
