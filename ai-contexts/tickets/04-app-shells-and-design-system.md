# 04 — Application Shells & Design System

**Bucket:** §3 · **Depends on:** 03 · **Blocks:** all UI tickets · **Size:** M
**Spec:** §4 (four surfaces), §28 (customer nav), §81 (RSC), §100 (progressive complexity), §102 (action-oriented)

## Why
Four audiences with different vocabularies share one codebase. Fixing the layouts, navigation and shared
primitives now means every feature ticket writes screens, not chrome.

## Scope

### Route groups & layouts
```
app/
  (public)/    layout.tsx   marketing header + footer, no auth
  (auth)/      layout.tsx   centred card, no nav
  dashboard/   layout.tsx   customer sidebar, requires org (DAL)
  staff/       layout.tsx   staff sidebar, requires staff (DAL)
  admin/       layout.tsx   admin sidebar, requires admin permissions
  api/                      route handlers (webhooks, downloads, AI stream)
```
Each protected layout calls the ticket-03 DAL. Layouts are Server Components; only interactive islands are
`'use client'` (§81).

### Design system
- Tailwind v4 + shadcn/ui. Define tokens as CSS variables: colour, spacing, radius, typography, elevation.
  Support light and dark.
- The brand must read as **a software delivery platform, not a code bazaar** (§107) — restrained, confident,
  business-first. Avoid the generic AI-startup look: no purple gradients on white, no Inter-everywhere.
- Distinct visual treatment per surface (public marketing vs dense staff tooling) sharing the same tokens.

### Shared primitives (`src/components/`)
`DataTable` (sortable, paginated, URL-state-driven) · `EmptyState` · `StatusBadge` (drives from the ticket-02
state enums so colours can't drift) · `Timeline` (§70) · `MoneyDisplay` (uses ticket-00 formatter — never
`toFixed`) · `FileDropzone` · `ConfirmDialog` · `PageHeader` · `StatCard` · `Attention` (the §102
"Needs Your Attention" pattern) · `Stepper` (checkout, product wizard) · `RichText` (safe render, sanitised).

### Navigation
- **Customer** (§28, MVP subset): Dashboard · Marketplace · My Software · Requests · Quotes · Orders · Invoices ·
  Messages · Notifications · Organization · Account. Deferred modules (Projects, Tickets, Testing, Subscriptions,
  Renewals, Tech Assistant) must **not** appear as dead links.
- **Staff**: Queues (default landing) · Requests · Customers · Quotes · Follow-ups · Messages.
- **Admin**: Products · Taxonomies · Orders · Payments & Providers · Users & Roles · Jobs · Settings.
- Nav is permission-filtered server-side; a hidden item is also blocked by the DAL.

### Conventions to establish (and document in `AGENTS.md`)
- `loading.tsx` per route segment; Suspense boundaries around anything reading `cookies()`/`headers()` or
  doing uncached I/O, so the static shell still renders.
- Search/filter/pagination state lives in the URL, not React state.
- Forms: server actions + `useActionState` + `useFormStatus`; validated with the shared Zod schema.
- Toasts for action feedback; optimistic updates only where a rollback is genuinely safe.
- Accessibility: keyboard-navigable, labelled controls, visible focus, AA contrast in both themes.

## Acceptance criteria
- [ ] All four shells render with correct nav for: signed-out, customer, each staff role, admin.
- [ ] A customer hitting `/staff` is redirected, and the server action behind any staff screen also refuses them.
- [ ] Deferred (post-MVP) modules appear nowhere in navigation.
- [ ] The customer dashboard shell leads with actions, not decorative statistics (§102).
- [ ] `MoneyDisplay` renders `£299.99` and `₦450,000.00` correctly from minor units.
- [ ] Dark mode is complete — no unstyled or invisible surfaces.
- [ ] Lighthouse accessibility ≥ 95 on the public marketplace and the customer dashboard.
- [ ] No client component imports a server-only module (build passes).

---

## Implementation notes (built 2026-08-15)

Delivered: the shadcn merge, four route-group shells, 12 shared primitives,
permission-filtered navigation, ~30 route segments, and 51 new tests (206 total).

### The shadcn merge did exactly the predicted damage, plus one more

`shadcn init` rewrites `globals.css` **in place**. Reviewing that diff was the
load-bearing step, and it had:

- replaced the warm `#fbfaf7` background with `oklch(1 0 0)`, and `#14130f`
  foreground with `oklch(0.145 0 0)` — Meridian's palette, gone;
- done the same to `--border`, `--ring`, `--muted-foreground` in **both** themes;
- **silently reset `--radius` to 0.625rem while keeping the comment explaining
  why it was pinned to 1rem** — the comment would have read as a lie;
- added a Geist font import to `layout.tsx` and put `--font-sans` on it, a brand
  change wearing the clothes of a setup step;
- emitted a self-referential `--font-sans: var(--font-sans)`.

The defence is structural rather than vigilance: **shadcn tokens are now aliases
(`--primary: var(--signal)`), never literals.** `init` can add tokens, but it
cannot quietly change a colour that is defined as `var(--surface)` without the
diff being obvious. `src/app/theme-tokens.test.ts` enforces this, along with the
radius pin, the Archivo mapping, and the `:where(.dark, .dark *)` variant that
`init` would replace with a `:is(.dark *)` version matching only descendants.

The `:focus-visible` reconciliation turned out to need no work: shadcn
components carry their own `outline-none` plus `focus-visible:ring-3`, and a
utility beats a base-layer rule, so our global outline switches off exactly
where a component draws its own ring. Verified rather than assumed.

### typedRoutes turns "no dead links" into a compile error

Enabled `typedRoutes: true`, which was not on. `<Link href="/projects">` is now
a build failure until `app/projects` exists — which is the ticket's "deferred
modules appear nowhere" criterion, enforced by the compiler rather than by
review. Turning it on immediately surfaced five real dead links (`/marketplace`,
`/custom-software`, `/terms`, `/privacy`, `/dashboard`) plus fifteen `href="#"`
placeholders in the footer.

The one place the guarantee can't hold is `safeRedirectPath()`, whose input is a
query-string value; the cast is confined there, behind the same-origin check.

### Bugs found by running it, not by types

1. **Icon components cannot cross the RSC boundary.** The nav config is built on
   the server and consumed by a client `SidebarNav` (it needs `usePathname`), and
   passing `LucideIcon` values through 500'd the entire shell. Icons are now
   *names* resolved client-side (`nav-icons.ts`), which makes the nav config
   serialisable — the right shape for data crossing a boundary anyway.
2. **Admin screens were gated on *view* permissions**, so `customer_service` —
   who legitimately holds `product.view_all` and `order.view_all` to answer a
   call — could walk into catalogue management. Re-gated on the permission each
   screen's *primary action* needs. Caught by a unit test, not by review.
3. **`finance` could cancel an order but not open the admin Orders screen.**
   Fixed by letting a nav item accept several permissions, any of which opens it
   — two jobs meet at that table.
4. **An error thrown in a *layout* renders the root `not-found.tsx` as a 404.**
   The `error.tsx` in a segment wraps the layout's *children*, not the layout, so
   a customer at `/staff` and a deactivated staff member both got "page not
   found". Layouts now redirect; pages and actions still throw.
5. **An error boundary renders client-side with a 200.** A staff member opening
   a screen their role doesn't cover saw a *blank pane* with JavaScript
   disabled, and every monitor was told the request succeeded. Switched pages to
   `forbidden()` (`experimental.authInterrupts`), which renders server-side and
   adds `noindex`.
6. **`--subtle` failed AA in both themes** — 3.26:1 light, 4.22:1 dark, against
   9.5px label text. Corrected to 4.66:1 and 4.80:1 measured against the *muted*
   surface, the hardest background it sits on.
7. **The avatar button failed WCAG 2.5.3.** `aria-label="Account menu"` over
   visible initials replaces the name rather than extending it. `aria-hidden` on
   the initials does not fix it — axe still counts them as visible text. An
   `sr-only` suffix does.

### Three guard flavours, by caller

`layout → redirect`, `page → forbidden()`, `server action → throw`. Same check,
three failure shapes, because a wrong turn, a refusal and a failed mutation are
different events. The table is in `dal.ts` and in `AGENTS.md`.

### Acceptance criteria — verified, with how

Measured against a **production build** (`next start`), not the dev server.

- [x] **All four shells render with correct nav** for signed-out, customer, and
      each staff role:

      | role                | /staff | /admin | staff nav | admin nav |
      |---------------------|--------|--------|-----------|-----------|
      | signed out          | →login | →login | — | — |
      | customer            | →/dashboard?denied=staff | →/dashboard?denied=staff | — | — |
      | customer_service    | 200 | →/staff?denied=admin | Queues, Requests, Quotes, Customers, Follow-ups, Messages | — |
      | marketplace_manager | 200 | 200 | Queues | Products, Taxonomies |
      | finance             | 200 | 200 | Queues, Quotes, Customers | Orders, Payments |
      | super_admin         | 200 | 200 | all six | all seven |

- [x] **A customer hitting `/staff` is redirected, and the screen behind it also
      refuses them.** Both halves checked: the customer redirects, and a
      `marketplace_manager` typing `/staff/requests`, `/admin/users`,
      `/admin/settings` gets a server-rendered refusal with `noindex` and no page
      content in the HTML — only the layout.
- [x] **Deferred modules appear nowhere** — `typedRoutes` makes it a compile
      error; a unit test covers the case it can't (a route later built for
      another reason making the dead link legal).
- [x] **The dashboard leads with actions** — attention list, then the two doors,
      then counters last.
- [x] **`MoneyDisplay` renders `£299.99` and `₦450,000.00`** from minor units,
      plus `¥500` for the zero-exponent case `toFixed(2)` would corrupt.
- [x] **Dark mode is complete** — enforced structurally: every literal in
      `:root` must have a `.dark` value, and nothing may exist only in dark.
- [x] **Lighthouse accessibility ≥ 95** — `/` **100**, `/marketplace` **100**,
      `/dashboard` **100**, zero failing audits.
- [x] **No client component imports a server-only module** — build passes;
      `formatBytes` was moved to `lib/` for exactly this reason.

### Known limitations

- **`forbidden()` returns 200, not 403.** The layout has already streamed by the
  time the page calls it, so the status is committed. The substance holds — no
  content leaks, the refusal is server-rendered, `noindex` is set — but anything
  reading status codes sees a 200. Inherent to streaming plus per-page
  authorization; revisit if Next gains a way to defer the status.
- **`experimental.authInterrupts`** is upstream-experimental. Exposure is two
  files: `requirePermissionOrForbid` and `app/forbidden.tsx`.
- **The public surface became dynamic** — `(public)/layout.tsx` reads the session
  so the header is right on first paint. Recorded in ticket 27, which owns PPR.
- **`@tanstack/react-table` was not used.** `DataTable` is a Server Component
  driven by URL state; the library would move all of it to the client for no
  gain, since MongoDB pages the data anyway.

