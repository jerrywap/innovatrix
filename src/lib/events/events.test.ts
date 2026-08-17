import { describe, expect, it } from "vitest";
import { DOMAIN_EVENTS } from "@/lib/db/enums";
import { CATALOG } from "@/services/notifications/catalog";
import { EVENT_NAMES } from "./index";

/**
 * The two event lists, and whether they agree.
 *
 * There are two: `DomainEventMap` in `src/lib/events/index.ts` is what can be
 * **emitted** — the compiler checks its payloads — and `DOMAIN_EVENTS` in
 * `src/lib/db/enums.ts` is the vocabulary `NotificationDoc.type` and
 * `ActivityEventDoc.type` describe, which is what makes an event appear on a
 * timeline.
 *
 * They had drifted to ten disagreements, and the direction matters:
 *
 * - In the **enum but not the map** meant a name nobody could emit. `ProductPublished`
 *   sat there from ticket 02 with no map entry, no `emit` call and no catalogue row,
 *   so "tell the vendor their product is live" had nothing to attach to — which is
 *   exactly the gap vendor ticket 05 walked into.
 * - In the **map but not the enum** means a live event whose rows a timeline cannot
 *   describe.
 *
 * Neither errors anywhere, which is why this test exists rather than a convention.
 *
 * ## Why this is not one list
 *
 * `enums.ts` is deliberately import-free so it can be read from client components and
 * validators; `events/index.ts` is `server-only` and imports the payload types. Making
 * the enum derive from the map would drag the server graph into a client bundle. So:
 * two lists, one test, modelled on the `REQUEST_TRANSITION_RULES` drift pair.
 */

describe("DomainEventMap and DOMAIN_EVENTS agree", () => {
  it("has no event that can be emitted but not described", () => {
    const missing = EVENT_NAMES.filter(
      (name) => !(DOMAIN_EVENTS as readonly string[]).includes(name),
    );
    expect(missing, "add these to DOMAIN_EVENTS").toEqual([]);
  });

  /**
   * Names in the enum that nothing can emit, and why each is still there.
   *
   * Allowlisted rather than deleted, following `ANONYMOUS_BY_DESIGN`'s idiom: an
   * exception is a decision somebody wrote down, not a gap that looks like one.
   *
   * These three are ticket 13's. `01-mvp-todo.md` row 15.3 records the state
   * exactly — "12 of 14 rows; `OrderCompleted`/`LicenceIssued` need ticket 13 to emit
   * after its transaction" — so they are reserved names with a known owner. Deleting
   * them is that ticket's call; emitting them is its work. What this test can do is
   * stop the *list* growing quietly.
   */
  const UNEMITTED_BY_DESIGN: Record<string, string> = {
    PaymentReceived: "ticket 13 — emitted after the fulfilment transaction",
    OrderCompleted: "ticket 13 — see 01-mvp-todo.md row 15.3",
    LicenceIssued: "ticket 13 — see 01-mvp-todo.md row 15.3",
  };

  it("has no event named in the enum that nothing can emit", () => {
    const orphans = DOMAIN_EVENTS.filter(
      (name) =>
        !(EVENT_NAMES as readonly string[]).includes(name) && !(name in UNEMITTED_BY_DESIGN),
    );
    expect(orphans, "either give these a DomainEventMap entry or delete them").toEqual([]);
  });

  it("has no stale entry in the unemitted allowlist", () => {
    // The other half of an allowlist. Once ticket 13 emits one of these, the line here
    // becomes a lie, and a lie in an allowlist is how the next exemption gets waved
    // through.
    const stale = Object.keys(UNEMITTED_BY_DESIGN).filter((name) =>
      (EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(stale, "these are emitted now — remove them from the allowlist").toEqual([]);
  });

  /**
   * A catalogue row for an event nobody emits is a notification that never arrives,
   * and it reads as coverage. The reverse is fine — plenty of events legitimately
   * notify nobody.
   */
  it("has no notification rule for an event that cannot be emitted", () => {
    const unreachable = Object.keys(CATALOG).filter(
      (name) => !(EVENT_NAMES as readonly string[]).includes(name),
    );
    expect(unreachable).toEqual([]);
  });

  it("still covers the events vendor ticket 05 depends on", () => {
    // Non-vacuity: the assertions above pass trivially against two empty lists.
    for (const name of [
      "ProductSubmitted",
      "ProductChangesRequested",
      "ProductApproved",
      "ProductPublished",
    ]) {
      expect(EVENT_NAMES, name).toContain(name);
      expect(DOMAIN_EVENTS as readonly string[], name).toContain(name);
      expect(Object.keys(CATALOG), name).toContain(name);
    }
  });
});
