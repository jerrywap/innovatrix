import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `loading.tsx` above a page that can refuse turns its 403 or 404 into a 200.
 *
 * ## The mechanism
 *
 * `loading.tsx` puts a Suspense boundary around its whole segment, which lets
 * Next flush the HTML shell before the page component resolves. Once bytes are
 * on the wire the status line is committed — so `forbidden()` and `notFound()`
 * still render the right body, under `200 OK`.
 *
 * That is not cosmetic. `forbidden()` exists precisely because a thrown error
 * renders client-side under a 200; recovering the correct status and then
 * throwing it away on the shell is the same bug one layer along. Anything
 * reading status codes — a crawler, a monitor, a CDN, `curl` in a runbook — is
 * told the request succeeded.
 *
 * ## The rule
 *
 * A segment containing a `loading.tsx` must contain no page, at that segment or
 * below it, that calls `forbidden()`, `notFound()`, or a `…OrForbid` guard.
 *
 * Streaming is not lost by obeying it: put the guard at the top of the page and
 * the slow query inside a `<Suspense>`. The guard resolves before the first
 * flush — so the status is right — and the shell still streams. What a
 * `loading.tsx` adds over that is a fallback during the *guard's* own latency,
 * which is a session read and one indexed query.
 *
 * Where the 404 depends on the main query — a detail page that loads a record
 * and calls `notFound()` — there is nothing to stream ahead of it, and blocking
 * is the correct behaviour rather than a regression.
 */

const APP = join(process.cwd(), "src", "app");

/** `forbidden()`, `notFound()`, and every DAL guard that ends in one. */
const REFUSES = /\bforbidden\(\)|\bnotFound\(\)|OrForbid\(/;

/**
 * Comments talk about `<Suspense>` and `notFound()`; only code counts.
 *
 * Crude, and deliberately so — a real parser here would be a dependency and a
 * second thing to be wrong. It strips block comments and line comments, which
 * is the whole of the false-positive surface in these files. The one thing it
 * would mangle is `//` inside a string literal, and a page component has no
 * reason to hold a URL in one.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

interface Route {
  /** Directory containing the file, relative to `src/app`. */
  segment: string;
  file: string;
  /** Comment-stripped source, present on refusing routes. */
  source?: string;
}

function walk(dir: string, found: { loading: Route[]; refusing: Route[] }): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      walk(full, found);
      continue;
    }

    const segment = relative(APP, dir);

    if (entry === "loading.tsx") {
      found.loading.push({ segment, file: relative(process.cwd(), full) });
      continue;
    }

    if (entry === "page.tsx" || entry === "layout.tsx") {
      const source = code(readFileSync(full, "utf8"));
      if (REFUSES.test(source)) {
        found.refusing.push({ segment, file: relative(process.cwd(), full), source });
      }
    }
  }
}

/**
 * Is `child` at or below `parent`?
 *
 * String prefixes are not enough: `dashboard/invoices` starts with
 * `dashboard/invoice` as a string and is a different segment. Hence the
 * separator, which is the same sibling-prefix trap `assertKeyInPrefix` guards
 * against in the storage layer.
 */
function covers(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent === "" ? "" : parent + sep);
}

describe("loading.tsx never sits above a page that can refuse", () => {
  const found: { loading: Route[]; refusing: Route[] } = { loading: [], refusing: [] };
  walk(APP, found);

  it("finds both kinds of route, so the test is actually looking at something", () => {
    // Guards the guard. A walk that silently found nothing would pass for ever.
    expect(found.refusing.length).toBeGreaterThan(10);
  });

  it("has no loading.tsx covering a refusing page", () => {
    const violations = found.loading.flatMap((loading) =>
      found.refusing
        .filter((page) => covers(loading.segment, page.segment))
        .map((page) => `${loading.file} covers ${page.file}`),
    );

    expect(violations).toEqual([]);
  });

  /**
   * The same bug one layer down.
   *
   * A guard inside a `<Suspense>`d child component runs *after* the shell has
   * flushed, so it commits 200 exactly as a `loading.tsx` would. It is the
   * easier mistake of the two to make, because the page looks well-structured:
   * the slow query is behind a boundary, and the guard travelled with it.
   *
   * Two of these were live — `/staff/customers` and `/admin/orders` — and both
   * served the 403 body to a staff member without the permission, under a
   * success status.
   */
  it("declares the guard in the page component, not inside a boundary", () => {
    const offenders = found.refusing
      .filter((route) => route.source?.includes("<Suspense"))
      .filter((route) => {
        const body = defaultExportBody(route.source!);
        // No recognisable default export ⇒ don't guess. The other test still
        // covers the segment, and a false failure here would train people to
        // ignore it.
        if (body === null) return false;
        return !REFUSES.test(body);
      })
      .map((route) => route.file);

    expect(offenders).toEqual([]);
  });
});

/**
 * The body of `export default [async] function …`, by brace counting.
 *
 * JSX braces balance, so counting is enough and does not need a parser. Returns
 * `null` when there is no such declaration — an arrow-function default export,
 * or a re-export — rather than pretending to an answer.
 */
function defaultExportBody(source: string): string | null {
  const match = /export\s+default\s+(?:async\s+)?function\b/.exec(source);
  if (!match) return null;

  /*
   * Skip the parameter list first.
   *
   * `function Page({ searchParams }: PageProps<…>)` opens a brace *before* the
   * body does, and counting from there returns the destructuring pattern — a
   * string with no guard in it, so every page taking props looked like a
   * violation. Found by the test reporting seven offenders, five of which were
   * correct code.
   */
  const paren = source.indexOf("(", match.index);
  if (paren === -1) return null;

  let parens = 0;
  let afterParams = -1;
  for (let i = paren; i < source.length; i += 1) {
    if (source[i] === "(") parens += 1;
    else if (source[i] === ")") {
      parens -= 1;
      if (parens === 0) {
        afterParams = i;
        break;
      }
    }
  }
  if (afterParams === -1) return null;

  const open = source.indexOf("{", afterParams);
  if (open === -1) return null;

  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return null;
}
