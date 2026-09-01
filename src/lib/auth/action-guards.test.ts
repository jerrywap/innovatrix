import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every server action and every route handler reaches the DAL — §88, ticket 26.
 *
 * ## Why this is a test and not a review checklist
 *
 * The ticket asks for "a lint rule or a test that walks the AST and fails on any
 * exported action whose first statement isn't a DAL guard — a manual grep will
 * drift". A server action is a public POST endpoint: nothing about the UI stops
 * anyone calling it directly, so an unguarded one is not untidy, it is open.
 * There are 77 of them across 20 files, and reviewing that by hand once tells
 * you about today.
 *
 * Modelled on `loading-boundaries.test.ts`, which is the working precedent for a
 * filesystem-walking architectural test in this codebase — including its
 * comment-stripping, without which a doc comment mentioning `requireOrg` makes
 * an unguarded action look guarded.
 *
 * ## The rule is "reaches a guard", not "starts with one"
 *
 * The ticket's phrasing is "whose first statement isn't a DAL guard", and
 * implementing that literally would fail five actions that are correct:
 *
 *   - `staff/actions.ts` guards through a local `staffActorFromSession()`
 *     helper, which calls `requireStaff()`. The guard is real; it is one
 *     function call away.
 *   - `products/actions.ts`'s `transitionProductAction` computes *which*
 *     permission to require from the input, then requires it. Parsing before
 *     guarding is the only way to write that, and it is still guarded.
 *
 * So the walk resolves local helpers transitively. What it will not accept is a
 * guard that is merely imported, or one inside a function the action never
 * calls.
 *
 * ## The allowlist is the point, not an escape hatch
 *
 * Some endpoints must serve an anonymous caller: a cart before sign-in, the
 * sign-in form itself, an AI conversation held under a cookie. Each is listed
 * below with a one-line reason, so "this action does not require a session" is
 * a decision somebody wrote down rather than an omission that looks like one.
 */

const ROOT = process.cwd();
const FEATURES = join(ROOT, "src", "features");
const API = join(ROOT, "src", "app", "api");

/**
 * A DAL call that establishes *authorisation*.
 *
 * `getSession` is deliberately not here. It reads the session and returns null
 * happily, which is exactly what an anonymous-capable action wants — so
 * treating it as a guard would let every allowlisted action pass the strict
 * rule and the allowlist would stop meaning anything.
 */
const GUARDS = [
  "requireUser",
  "requireVerifiedUser",
  "requireOrg",
  "requireOrgOrNull",
  "requireOrgRoleOrForbid",
  "assertOrgAccess",
  "requireStaff",
  "requireStaffOrRedirect",
  "requirePermission",
  "requireAllPermissions",
  "requireAnyPermission",
  "requireAnyPermissionOrRedirect",
  "requirePermissionOrForbid",
  "requireAnyPermissionOrForbid",
  // Vendor tickets 01, 03. A vendor is a third principal, so its guards must be
  // listed here or every vendor action reads as unguarded — which is the failure
  // this test is for, in the direction that matters.
  "requireVendor",
  "requireVendorOrNull",
  "requireVendorOrForbid",
  "requireVendorOwner",
] as const;

const GUARD_CALL = new RegExp(`\\b(${GUARDS.join("|")})\\s*\\(`);
const SESSION_CALL = /\bgetSession\s*\(/;

/**
 * `.ts` **and** `.tsx` — the second half closes a hole rather than widening scope.
 *
 * The walk used to match `.ts` only, which was correct for as long as every
 * `"use server"` module was plain TypeScript. It is fail-open, though: a server
 * action that returns JSX has to live in a `.tsx` file, and such a file was
 * invisible here — so its exported actions were never checked and an unguarded one
 * would have passed this suite in silence. `marketplace/append-actions.tsx` is the
 * first of them, and the reason this was found.
 */
const IS_SOURCE = (file: string) => file.endsWith(".ts") || file.endsWith(".tsx");

/**
 * Actions that may run without an authenticated caller, and why.
 *
 * Every one of these still *reads* the session and scopes its work by whatever
 * it finds — an anonymous cart key, a conversation cookie, an email address
 * being registered. None of them takes a caller's word for who they are.
 */
const ANONYMOUS_BY_DESIGN: Record<string, string> = {
  // A cart exists before an account does (§12). Ownership is the signed cookie
  // key when there is no session, and the merge on sign-in is what reconciles
  // the two.
  "cart/actions.ts:addToCartAction": "guest cart",
  "cart/actions.ts:removeLineAction": "guest cart",
  "cart/actions.ts:setQuantityAction": "guest cart",
  "cart/actions.ts:applyDiscountAction": "guest cart",
  "cart/actions.ts:removeBlockedLinesAction": "guest cart",
  // Also the header's switcher, so it runs for anyone browsing — including
  // somebody with no basket at all, which is why it reads the owner key rather
  // than minting one.
  "cart/actions.ts:switchCurrencyAction": "guest cart",
  // `mergeCartAction` used to be listed here as "runs at sign-in, over both
  // keys". It never ran anywhere — it had no callers at all — so this entry was
  // an enforcement test documenting behaviour that did not exist. The merge is
  // now a plain function in `features/auth/adopt-guest-state.ts`, called from
  // every sign-in path, and is no longer an endpoint needing an exemption.

  // Pre-auth by definition — these are how a session comes to exist.
  "auth/actions.ts:registerAction": "creates the account",
  "auth/actions.ts:signInAction": "creates the session",
  "auth/actions.ts:signInWithGoogleAction": "starts the session, at Google",
  "auth/actions.ts:forgotPasswordAction": "the caller has lost their password",
  "auth/actions.ts:resetPasswordAction": "authenticated by the emailed token",
  "auth/actions.ts:acceptInviteAction": "authenticated by the invitation token",
  "auth/actions.ts:resendVerificationAction": "reads the session, tolerates none",
  // Ends a session; with none to end it is a no-op and a redirect. Guarding it
  // would mean redirecting an already-signed-out visitor to /login to sign out.
  "auth/actions.ts:signOutAction": "destroys a session rather than using one",
  "auth/actions.ts:setActiveOrganizationAction": "membership is re-read by requireOrg",

  // §71: the AI doors are open to somebody who has not signed up yet — that is
  // the acquisition funnel. Ownership is the `cosetup_conv` cookie,
  // passed into `getConversation()` as scope rather than trusted from input.
  "requirements/actions.ts:startConversationAction": "anonymous AI conversation",
  "requirements/actions.ts:abandonConversationAction": "anonymous AI conversation",
  "requirements/actions.ts:summariseConversationAction": "anonymous AI conversation",
  "requirements/actions.ts:recordRecommendationChoiceAction": "anonymous AI conversation",

  /*
   * A public catalogue read — the next page of the marketplace grid, appended as
   * you scroll. There is nothing to authorise: it returns exactly the cards an
   * anonymous visitor already sees on the page that called it, and every parameter
   * goes back through `parseMarketplaceQuery`.
   *
   * Also in `READ_ONLY` below, which is the unusual part — see the note there.
   */
  "marketplace/append-actions.tsx:appendMarketplacePageAction": "public catalogue read",

  // Vendor ticket 03. The one vendor action whose caller is *not* yet a vendor —
  // every `requireVendor*` guard would refuse the very person it is for. It reads
  // the session and refuses without one; the checks that matter (the invitation's
  // email matches the session's, and that address is verified) are in
  // `member-service.acceptInvitation`, where a second caller cannot skip them.
  // Assertion 3 below still requires this to reach `getSession`.
  "vendors/actions.ts:acceptVendorInviteAction": "the invitee is not a member yet",
};

/**
 * Allowlisted actions that legitimately never look at the session at all.
 *
 * The rule below — "an allowlisted action still reads the session" — is a good
 * one, and it holds because every other entry in `ANONYMOUS_BY_DESIGN` **mutates**
 * something owned by an anonymous caller: a guest cart has to become the
 * customer's cart on sign-in, an anonymous conversation has to be claimable. Such
 * an action that never looked at the session could not tell those apart.
 *
 * A **read-only** action is a category that rule does not model. Appending a page
 * of a public grid returns the same cards to everyone; there is nothing to scope
 * and nothing to reconcile later. Satisfying the rule would mean writing a
 * `getSession()` call whose result is discarded — a statement in the source that
 * this endpoint depends on the session, which is false, and which the next reader
 * would have to disprove.
 *
 * So the exemption is named here rather than faked there. Keep it to genuinely
 * read-only actions: the moment one writes anything, it belongs under the rule.
 */
const READ_ONLY: Record<string, string> = {
  "marketplace/append-actions.tsx:appendMarketplacePageAction":
    "returns public cards; nothing is scoped to a caller",
};

/**
 * Route handlers that authenticate by something other than a session, and why.
 *
 * Each is a real authentication mechanism, not an absence of one.
 */
const NON_SESSION_ROUTES: Record<string, string> = {
  "auth/[...all]/route.ts": "Better Auth's own handler — it is the auth system",
  "webhooks/[provider]/route.ts": "the provider's signature is the credential (§87)",
  "cron/reconcile/route.ts": "CRON_SECRET, constant-time, 503 when unset",
  "cron/tick/route.ts": "CRON_SECRET, constant-time, 503 when unset",
  "licences/activate/route.ts": "the licence key is the credential (§65)",
  /*
   * Unauthenticated because an uptime monitor has no session — and it is safe
   * to be, because it says nothing: three booleans and a duration. No versions,
   * no hostnames, no error text. A health endpoint that explains itself is a
   * reconnaissance surface.
   *
   * Caught by this test the moment it was added, which is the point of the
   * test: an exemption is a decision somebody wrote down, not a gap.
   */
  "health/route.ts": "an uptime monitor has no session; the body reveals nothing",
  /*
   * It cannot authenticate: it exists precisely for the caller whose session is
   * *invalid*. Requiring one would make it unreachable by the only people who
   * need it, and it grants nothing — it deletes cookies and redirects to
   * `/login`. The worst an attacker achieves is signing themselves out.
   */
  "auth/stale-session/route.ts":
    "the caller's session is already rejected; it only clears cookies",
  /*
   * It runs *because* a session was just created — it is where Google's
   * `callbackURL` lands — so there is no earlier moment at which a guard could
   * be satisfied by anyone but the person it is for. It reads the session off
   * the request and does nothing at all without one.
   *
   * What it grants is bounded to the caller's own two guest cookies: their cart
   * is folded into their account and their anonymous conversation is claimed.
   * Somebody who forges neither cookie gets a redirect and nothing else.
   */
  "auth/after-sign-in/route.ts":
    "it is the landing point of a sign-in; it adopts only the caller's own cookies",
};

/* ────────────────────────────────────────────── the walk */

interface Fn {
  name: string;
  body: string;
  exported: boolean;
}

/** Strip comments — only code counts. Same reasoning as the loading test. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every function declaration in a file, with its body.
 *
 * Brace counting rather than a parser: a parser here would be a dependency and
 * a second thing to be wrong, and JSX is not involved in an actions file.
 */
function functions(source: string): Fn[] {
  const found: Fn[] = [];
  /*
   * The `(?:<[^(]*>)?` is for **generic** declarations, and it closes a fail-open
   * gap rather than a cosmetic one.
   *
   * Without it `function save<S extends z.ZodType>(` does not match, so a generic
   * helper is invisible and the guard it calls stops counting for everything that
   * calls it — noisy but safe. The dangerous half is the same omission on an
   * *exported* generic: `export async function doThing<T>(…)` would not be
   * discovered at all, so it would never be checked, and an unguarded action would
   * pass this suite in silence. Found while adding the vendor wizard, whose section
   * saves share a generic helper.
   *
   * `[^(]*` rather than `.*` so the type parameter list cannot swallow the
   * parameter list's own opening paren.
   */
  const declaration =
    /(export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*(?:<[^(]*>)?\s*\(/g;

  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source)) !== null) {
    const open = source.indexOf("(", match.index + match[0].length - 1);
    const afterParams = closing(source, open, "(", ")");
    if (afterParams === -1) continue;

    const bodyStart = bodyBrace(source, afterParams);
    if (bodyStart === -1) continue;

    const bodyEnd = closing(source, bodyStart, "{", "}");
    if (bodyEnd === -1) continue;

    found.push({
      name: match[2]!,
      body: source.slice(bodyStart, bodyEnd + 1),
      exported: Boolean(match[1]),
    });
  }

  return found;
}

/**
 * The brace that opens the body, skipping the return-type annotation.
 *
 * `): Promise<ActionResult<{ orderId: string }>> {` has a `{` in it before the
 * body's, so a plain `indexOf("{")` after the parameter list returns the
 * *return type* and every action's "body" comes back as `{ orderId: string }`
 * — a string with no guard in it, so all 77 looked unguarded. Reported as 60
 * offenders on the first run, every one of them correct code.
 *
 * Tracking angle-bracket depth is enough because the only thing between `)` and
 * the body brace in a function declaration is a type.
 */
function bodyBrace(source: string, afterParams: number): number {
  let angle = 0;

  for (let i = afterParams + 1; i < source.length; i += 1) {
    const char = source[i];
    if (char === "<") angle += 1;
    else if (char === ">") angle -= 1;
    else if (char === "{" && angle === 0) return i;
  }

  return -1;
}

function closing(source: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let i = from; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * Does this function reach a guard, directly or through a local helper?
 *
 * `seen` breaks the cycle on mutual recursion, which no action has today and
 * which would otherwise hang the suite rather than fail it.
 */
function reaches(
  fn: Fn,
  all: Map<string, Fn>,
  pattern: RegExp,
  seen = new Set<string>(),
): boolean {
  if (seen.has(fn.name)) return false;
  seen.add(fn.name);

  if (pattern.test(fn.body)) return true;

  for (const [name, candidate] of all) {
    if (name === fn.name) continue;
    // A call to a helper declared in this same file.
    if (
      new RegExp(`\\b${name}\\s*\\(`).test(fn.body) &&
      reaches(candidate, all, pattern, seen)
    ) {
      return true;
    }
  }

  return false;
}

function walk(dir: string, match: (file: string) => boolean): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...walk(full, match));
    else if (match(full)) found.push(full);
  }

  return found;
}

/* ────────────────────────────────────────────── tests */

describe("every server action reaches a DAL guard — §88", () => {
  /*
   * `code()` first, so a *comment* mentioning the directive is not mistaken for it.
   *
   * This filter used to read the raw source, which meant any file whose prose said
   * the words — `section-config.ts` opens with "Pure data and pure functions, no
   * `"use server"`" — was walked as an action module. It had never fired, because
   * that file exported only `const` objects; the day it exported a pure helper, the
   * test demanded a DAL guard on a function that is not reachable over HTTP.
   *
   * Tightening it is not a loosening of the guard: `code()` strips comments and
   * nothing else, and the count assertion below is what proves the walk still
   * finds the real ones.
   */
  const files = walk(FEATURES, IS_SOURCE).filter((file) =>
    code(readFileSync(file, "utf8")).includes('"use server"'),
  );

  it("finds the action files, so the test is looking at something", () => {
    // Guards the guard: a walk that silently matched nothing would pass for ever.
    expect(files.length).toBeGreaterThan(15);
  });

  it("guards every exported action, or names it in the allowlist", () => {
    const unguarded: string[] = [];

    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));
      const all = new Map(functions(source).map((fn) => [fn.name, fn]));
      const key = relative(FEATURES, file).replaceAll("\\", "/");

      for (const fn of all.values()) {
        if (!fn.exported) continue;

        const id = `${key}:${fn.name}`;
        if (id in ANONYMOUS_BY_DESIGN) continue;
        if (reaches(fn, all, GUARD_CALL)) continue;

        unguarded.push(id);
      }
    }

    expect(unguarded).toEqual([]);
  });

  it("still reads the session in every allowlisted action", () => {
    /*
     * The allowlist says "no session required", not "no session considered".
     *
     * Each of these scopes its work by whoever is signed in when somebody is —
     * a guest cart must become the customer's cart, an anonymous AI
     * conversation must be claimable. An allowlisted action that never looked
     * at the session would be one that cannot tell those apart, and the
     * allowlist would be hiding it.
     */
    const blind: string[] = [];

    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));
      const all = new Map(functions(source).map((fn) => [fn.name, fn]));
      const key = relative(FEATURES, file).replaceAll("\\", "/");

      for (const fn of all.values()) {
        const id = `${key}:${fn.name}`;
        if (!(id in ANONYMOUS_BY_DESIGN)) continue;

        const aware = new RegExp(`${SESSION_CALL.source}|${GUARD_CALL.source}`);
        // `auth` actions are the exception within the exception: `signInAction`
        // has no session to read, because reading one is what it produces.
        if (key.startsWith("auth/")) continue;
        // And read-only public reads, which have nothing to scope. See `READ_ONLY`.
        if (id in READ_ONLY) continue;
        if (!reaches(fn, all, aware)) blind.push(id);
      }
    }

    expect(blind).toEqual([]);
  });

  it("never excuses a session read for an action the allowlist does not name", () => {
    // `READ_ONLY` weakens one rule; it must not become a way around the other.
    // Every entry has to be in `ANONYMOUS_BY_DESIGN` too, which is also what makes
    // the stale check below cover both lists with one set of keys.
    const unlisted = Object.keys(READ_ONLY).filter((id) => !(id in ANONYMOUS_BY_DESIGN));
    expect(unlisted).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    // An allowlist that outlives the action it excused is a hole nobody can see.
    const live = new Set<string>();

    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));
      const key = relative(FEATURES, file).replaceAll("\\", "/");
      for (const fn of functions(source)) {
        if (fn.exported) live.add(`${key}:${fn.name}`);
      }
    }

    const stale = Object.keys(ANONYMOUS_BY_DESIGN).filter((id) => !live.has(id));
    expect(stale).toEqual([]);
  });
});

describe("scope comes from the session, never from the request — §88", () => {
  /**
   * The other half of ticket 26's authorization audit: "confirm no
   * `organizationId` is ever accepted from client input for scoping".
   *
   * The naive rule — "no action declares one" — is wrong, and running it said
   * so: three files do, and all three are correct. The distinction is **who is
   * asking**.
   *
   * - A **customer** action must never accept one. Their scope is their
   *   membership, `requireOrg()` reads it from the session, and an accepted id
   *   would be a claim about whose data to touch. The failure is silent: the
   *   code reads as though it were scoped, and it is — to whatever was sent.
   * - A **staff** action legitimately does. Staff work across organisations by
   *   design (§30), so the id is not "my scope", it is "the customer I am
   *   acting on". `requireStaff()` plus a permission is the check; the id is a
   *   parameter, not an authorisation.
   *
   * So the rule is per **action**, not per file: an action that reads an
   * `organizationId` out of its parsed input must reach a staff guard.
   *
   * Per file was the first attempt and it reported two false positives —
   * `messaging/actions.ts` and `quotes/actions.ts` each hold a customer action
   * and a staff action side by side, which is the right way to organise them.
   * Co-location is not the smell; a *customer* action reading a supplied org id
   * is.
   */
  const files = walk(FEATURES, IS_SOURCE).filter((file) =>
    readFileSync(file, "utf8").includes('"use server"'),
  );

  /** `parsed.organizationId` / `input.organizationId` — an id that came in. */
  const CONSUMES_ORG = /\b(?:parsed|input)\.organizationId\b/;
  const STAFF_GUARD =
    /\brequireStaff\s*\(|\brequirePermission\s*\(|\brequireAnyPermission\s*\(/;

  function consumers(): Array<{ id: string; guarded: boolean }> {
    const found: Array<{ id: string; guarded: boolean }> = [];

    for (const file of files) {
      const source = code(readFileSync(file, "utf8"));
      const all = new Map(functions(source).map((fn) => [fn.name, fn]));
      const key = relative(FEATURES, file).replaceAll("\\", "/");

      for (const fn of all.values()) {
        if (!fn.exported || !CONSUMES_ORG.test(fn.body)) continue;
        found.push({ id: `${key}:${fn.name}`, guarded: reaches(fn, all, STAFF_GUARD) });
      }
    }

    return found;
  }

  it("only lets a staff-guarded action act on a supplied organizationId", () => {
    const unguarded = consumers()
      .filter((entry) => !entry.guarded)
      .map((entry) => entry.id);
    expect(unguarded).toEqual([]);
  });

  it("finds actions that do consume one, so the rule is not vacuous", () => {
    // If this drops to zero the rule above passes because it checks nothing,
    // which is the failure mode of every rule shaped like this one.
    expect(consumers().length).toBeGreaterThan(0);
  });
});

describe("every route handler authenticates — §88", () => {
  const files = walk(API, (file) => file.endsWith("route.ts"));

  it("finds the route handlers", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("guards every route, or names its other credential", () => {
    const open: string[] = [];

    for (const file of files) {
      const key = relative(API, file).replaceAll("\\", "/");
      if (key in NON_SESSION_ROUTES) continue;

      const source = code(readFileSync(file, "utf8"));
      const aware = new RegExp(`${SESSION_CALL.source}|${GUARD_CALL.source}`);

      if (!aware.test(source)) open.push(key);
    }

    expect(open).toEqual([]);
  });

  it("has no stale route exemptions", () => {
    const live = new Set(files.map((file) => relative(API, file).replaceAll("\\", "/")));
    const stale = Object.keys(NON_SESSION_ROUTES).filter((key) => !live.has(key));
    expect(stale).toEqual([]);
  });
});
