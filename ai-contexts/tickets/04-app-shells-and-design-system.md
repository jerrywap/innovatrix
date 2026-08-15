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
