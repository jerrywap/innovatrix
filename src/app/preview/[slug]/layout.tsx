/**
 * The preview shell — deliberately outside every route group.
 *
 * ## Why not `(public)`
 *
 * `(public)/layout.tsx` hard-wires `PublicHeader` and `PublicFooter` with no
 * prop, flag or conditional to turn them off — chrome there is unconditional, so
 * "chrome-less" can only mean "not in that group". `(auth)` is the precedent for
 * a stripped shell with its own small bar, and this follows its structure.
 *
 * A top-level segment rather than a new `(preview)` group, for one concrete
 * reason: `sitemap.test.ts` hard-codes `ROUTE_GROUPS = ["", "(public)", "(auth)"]`,
 * and a plain segment is already covered by the `""` entry. A new group would
 * mean editing a test that exists to catch an entirely different bug.
 *
 * ## No `instant = false`
 *
 * Every route that predates Cache Components carries that opt-out as migration
 * debt; the convention is that routes built afterwards are built natively. This
 * one is, so it does not get one — the session read that would otherwise block
 * the route lives inside a `<Suspense>` in the page.
 *
 * ## The layout holds no chrome of its own
 *
 * The bar belongs to the page, because it needs the product — its name, its
 * targets — and a layout cannot see the page's data. What this file contributes
 * is the viewport box: full height, no page scroll, so the stage can size itself
 * against something definite.
 */
export default function PreviewLayout({ children }: LayoutProps<"/preview/[slug]">) {
  /*
   * `h-dvh` with `overflow-hidden`, and `min-h-0` on the child that grows.
   *
   * `dvh` rather than `%` or `vh` for the reason `(auth)/layout.tsx` sets out at
   * length: a percentage resolves against a parent whose height comes from its
   * content, and `vh` ignores a phone's shrinking toolbar. `overflow-hidden`
   * because this is the one page in the app that must not scroll — the frame
   * scrolls, not the page around it.
   *
   * The root layout's `<body>` is `flex min-h-full flex-col`, so this is a flex
   * item; `min-h-0` further down is what stops the frame refusing to shrink and
   * pushing the bar off the top.
   */
  return <div className="bg-background flex h-dvh flex-col overflow-hidden">{children}</div>;
}
