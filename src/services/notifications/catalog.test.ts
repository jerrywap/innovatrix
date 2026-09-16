import { describe, expect, it } from "vitest";
import { CATALOG } from "./catalog";
import { notificationEmail } from "@/emails/notification";

/**
 * The purchase confirmation, and the button labels that go with it.
 *
 * ## Why this is a unit test and not an integration one
 *
 * Every rule in `CATALOG` is a set of pure functions over an event payload.
 * Rendering one needs no database, no transaction and no index — so asserting
 * what a customer reads is a unit test, and the integration file's job stays
 * what it already covers: that dispatch writes one row, that preferences are
 * honoured, and that an essential category cannot be muted.
 *
 * ## Why it exists at all
 *
 * `OrderCompleted` was in `DOMAIN_EVENTS` from ticket 02 and emitted nowhere,
 * so a customer paid, received a licence, and got no email — while
 * `/orders/[reference]/confirmation` told them "a receipt lands in your inbox".
 * The two things that must not regress are the ones this asserts: that the
 * receipt exists at all, and that it never carries a licence key.
 */

const ORDER = {
  orderId: "6a80c46f6c887b38e2f0e0c1",
  reference: "ORD-2026-0042",
  organizationId: "6a80c46f6c887b38e2f0e0c2",
  description: "Ejenxy Creative Digital Agency",
  hasDownloads: true,
};

function orderRule() {
  const [rule] = CATALOG.OrderCompleted ?? [];
  if (!rule) throw new Error("OrderCompleted has no notification rule");
  return rule;
}

describe("the purchase confirmation — OrderCompleted", () => {
  it("is a receipt, so nothing can mute it", () => {
    const rule = orderRule();
    expect(rule.category).toBe("billing");
    expect(rule.essential).toBe(true);
  });

  it("names the order in the subject, so two receipts are not identical", () => {
    const email = orderRule().email?.(ORDER, { url: "https://cosetup.net/dashboard/software" });

    expect(email?.subject).toBe("Your CoSetup order ORD-2026-0042 is confirmed");
    expect(email?.heading).toBe("Your order is confirmed");
    expect(email?.body[0]).toBe(
      "We've received your payment for Ejenxy Creative Digital Agency. Your purchase is ready in CoSetup.",
    );
  });

  it("sends a customer with downloads to their purchases, and one without to the order", () => {
    const rule = orderRule();

    expect(rule.href(ORDER)).toBe("/dashboard/software");
    expect(rule.href({ ...ORDER, hasDownloads: false })).toBe(
      "/dashboard/orders/ORD-2026-0042",
    );

    // The label follows the destination rather than describing it generically.
    const withDownloads = rule.email?.(ORDER, { url: "https://example.test" });
    const without = rule.email?.(
      { ...ORDER, hasDownloads: false },
      { url: "https://example.test" },
    );
    expect(withDownloads?.action?.label).toBe("View my purchase");
    expect(without?.action?.label).toBe("View my order");
  });

  /**
   * The rule that outlives this file.
   *
   * A licence key belongs behind a sign-in. An inbox has no permission check, is
   * forwarded, quoted and synced to third-party clients, and an email that
   * carried a key would hand activation to anybody who ever saw the thread. The
   * confirmation says the licence is *ready* and links to where it lives.
   */
  it("never puts the licence itself in the email", () => {
    const email = orderRule().email?.(ORDER, { url: "https://cosetup.net/dashboard/software" });
    const everything = [
      email?.subject,
      email?.preheader,
      email?.heading,
      ...(email?.body ?? []),
      ...(email?.notes ?? []),
    ].join(" ");

    expect(everything).not.toMatch(/\bkey\b(?!s\b)/i);
    expect(everything).toContain("available now in My Purchases");
  });

  it("does not promise downloads to an order that has none", () => {
    const email = orderRule().email?.(
      { ...ORDER, hasDownloads: false },
      { url: "https://example.test" },
    );
    expect(email?.notes?.join(" ")).not.toContain("My Purchases");
  });
});

/**
 * §27 — a button that says where it goes.
 *
 * "Open in CoSetup" was the label on every one of these, so a vendor whose
 * product went live and a customer whose invoice fell due were offered the same
 * one. `actionLabel` is opt-in, and the assertion below is about the ones that
 * opted in, not about every row.
 */
describe("email action labels", () => {
  it.each([
    ["ProductPublished", "View live product"],
    ["ProductApproved", "View product"],
    ["ProductChangesRequested", "Review requested changes"],
    ["QuoteIssued", "View quote"],
    ["InvoiceIssued", "View invoice"],
    ["InvoiceDueSoon", "View invoice"],
    ["ProductVersionReleased", "View purchase"],
    ["CustomizationRoutedToVendor", "View request"],
    ["VendorSupportThreadOpened", "View message"],
    ["DisputeResolved", "View dispute"],
    ["VendorPayoutPaid", "View payout"],
    ["VendorPayoutFailed", "Review payout"],
  ])("%s says %s", (event, label) => {
    const rules = CATALOG[event as keyof typeof CATALOG] ?? [];
    const labels = rules.map((rule) => rule.actionLabel);
    expect(labels).toContain(label);
  });

  it("falls back to the generic label when a rule names none", () => {
    const generic = notificationEmail({
      to: "someone@example.test",
      title: "Something happened",
      url: "https://example.test",
      category: "requests",
    });
    expect(generic.text).toContain("Open in CoSetup");

    const named = notificationEmail({
      to: "someone@example.test",
      title: "Your invoice is ready",
      url: "https://example.test",
      category: "billing",
      actionLabel: "View invoice",
    });
    expect(named.text).toContain("View invoice");
    expect(named.text).not.toContain("Open in CoSetup");
  });
});
