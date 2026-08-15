# FleetBuild — Master Task Bucket List

Derived from `claude-contexts/projectlogic.md` (the product spec - always read it to obtain full context) cross-checked against the
**current state of the codebase** (controllers, models, the big `2026_06_05_..._create_parallel_app_domain_tables`
migration, the three.js builder under `resources/js/lib/three` + `resources/js/lib/builder`, and every page under
`resources/js/pages`).

Status key: `[x]` Done · `[~]` Skeleton/partial (UI or stub exists, real behaviour missing) · `[ ]` Not started

Column meaning: **Frontend** = React/Inertia page, components, wiring. **Backend** = Laravel controller, model,
migration, storage, jobs, real business logic.

> **Big-picture reality check.** A lot of *surface* exists: builds CRUD, procurement CRUD, an approval state
> machine, a real 3D builder, and good-looking pages for nearly every screen. The gaps are the *deep* behaviours
> the spec demands: immutable "complete build", screenshot capture + S3, three distinct template systems, the RFP
> generation **wizard**, real **track-changes** approvals, **System Setup** (configurable approval levels), and a
> **separate vendor authentication system** (today the vendor portal is public + demo-data only).

---

## 0. Foundation & Infrastructure

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 0.1 | Laravel + Inertia + React + Tailwind starter | [x] | [x] |
| 0.2 | Auth (Fortify): login/register/reset/verify/2FA/passkeys | [x] | [x] |
| 0.3 | Roles enum (`UserRole`) + permission matrix (`RoleAccess`) + gates | [x] | [x] |
| 0.4 | Organization tenancy (`organization_id` scoping on all domain tables) | [x] | [x] |
| 0.5 | Role seeder (`RoleUserSeeder`) + demo org | — | [x] |
| 0.6 | Domain tables migration (builds, items, templates, procurement, documents, approvals, bids, trackers, notifications) | — | [x] |
| 0.7 | Sidebar / app nav driven by permissions | [x] | [x] |
| 0.8 | **S3 / object storage configured** (filesystem disk, env, credentials) — required for §2, §3 | — | [x] | ← impl 2: `league/flysystem-aws-s3-v3` installed, creds set, live connectivity verified (put + signed URL) |
| 0.9 | **PDF generation library** chosen + wired (e.g. dompdf / browsershot) — required for §5 | — | [x] | ← impl 5: `barryvdh/laravel-dompdf` + RFP PDF export |
| 0.10 | **AI/LLM integration** for template summaries + RFP section generation — required for §6–§10 | — | [x] | ← `AiReasoner` service over **OpenRouter** (Gemini `google/gemini-3-flash-preview`); live call verified. Feature consumption pending §6/§7/§9 |
| 0.11 | **Local image processing** (Intervention Image or GD) for 300×300 draft thumbnails | — | [ ] |

---

## 1. Dashboard

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 1.1 | Dashboard page (stats cards, activity feed, fleet-activity chart) | [x] | [x] |
| 1.2 | Create dropdown (New Build / RFP / RFQ / Review Bids), permission-gated | [x] | [x] |
| 1.3 | Live stats aggregation (draft builds, pending approvals, published RFPs, bids) | [x] | [x] |
| 1.4 | Tailor dashboard to user role/level (spec §1 — "tailored to user's data, org, roles, level") — verify per-role variants are correct | [~] | [~] |

---

## 2. Vehicle Builds (listing & lifecycle)

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 2.1 | `/vehicle-builds` list — Draft / Completed tabs, thumbnails, stats | [x] | [x] |
| 2.2 | Create-new-build dialog → launches builder | [x] | [x] |
| 2.3 | Delete build | [x] | [x] | ← impl 3 follow-up: delete in draft + completed menus, confirm dialog, and S3/local thumbnail+screenshot files cleaned up (no orphans) |
| 2.4 | "Continue" draft → opens builder with restore snapshot | [x] | [x] | ← impl 1: Continue/View open by `buildId` only; builder loads the build & replays `configuration_json` (colour/scene/time/lights/upfits/doors); name/type/spec/vehicle seeded from the build, never URL params; completed builds open read-only |
| 2.5 | **Rename build from the builds table** (spec §2 — rename from table OR builder) | [x] | [x] | ← impl 1 |
| 2.6 | **Clone a completed build into a fresh draft** (spec §2/§3 — "clone a fresh build from it") | [~] | [ ] |
| 2.7 | "Save As Template" from a completed build (→ §6) | [~] | [~] |
| 2.8 | "View Vehicle Configuration" / preview in simulate (read-only) from the table | [x] | [x] | ← impl 1 follow-up: completed "View Vehicle Configuration" opens builder by buildId → restores + opens read-only (simulate) |
| 2.9 | **Status lifecycle enforcement**: draft → completed (immutable) — block edits to completed builds server-side | [x] | [x] | ← impl 1 |

---

## 3. 3D Builder / Modeller (`/builder`)

The builder itself (three.js engine, GLTF loaders, light/upfit install, camera focus, screenshot via
`toDataURL`, simulate mode, Interceptor L/R pairs) **already exists and works**. The spec asks us to
*re-wire its CTAs and persistence behaviour*.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 3.1 | three.js engine, loaders, light/upfit catalog, simulate mode | [x] | — |
| 3.2 | Interceptor paired-lights + door/trunk animations (see `temp-notes.md`, `03-interceptor.md`) | [x] | — |
| 3.3 | Save-as-draft posts build + items to backend | [x] | [x] |
| 3.4 | **Remove "Request For Quote" and "Generate RFP" buttons** (spec §2) | [x] | — | ← impl 1 |
| 3.5 | **New CTA set: `Save As Draft`, `Complete Build`** | [x] | — | ← impl 1 |
| 3.6 | **"Complete Build" confirmation dialog** ("once completed you cannot modify, but you can clone a fresh build") | [x] | — | ← impl 1 |
| 3.7 | **First-save name prompt** — prefill with vehicle model, editable, then save | [x] | [x] | ← impl 1 |
| 3.8 | **Rename from builder screen** | [x] | [x] | ← impl 1 |
| 3.9 | **Autosave every 30s while in draft mode** | [x] | [x] | ← impl 1 |
| 3.10 | Complete-build endpoint: flips status to `completed`, makes build immutable | [x] | [x] | ← impl 1 |

---

## 4. Build Screenshots & Storage

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 4.1 | **On draft save: capture ONE icon screenshot** (three.js `toDataURL`), max 300×300, **local path**, overwrite existing (single thumbnail per build) | [x] | [x] | ← impl 1 |
| 4.2 | Thumbnail shown on builds table / cards (replace current placeholder thumbs) | [x] | [x] | ← impl 1 |
| 4.3 | **On Complete Build: "Saving screenshots — do not close" preloader** screen | [x] | — | ← impl 2 |
| 4.4 | **Final multi-angle capture**: left, rear, right, front, top — drive camera to each, screenshot | [x] | — | ← impl 2 |
| 4.5 | **Per-item area views** — reuse builder's per-item camera auto-focus to capture each added component | [x] | — | ← impl 2 (items with a `cameraView`) |
| 4.6 | **Upload final screenshots to S3**, organised by build id/name → `part-{name}.png`, idempotent | [x] | [x] | ← impl 2 (S3 when adapter installed, else local fallback) |
| 4.7 | Persist screenshot references (cols/table) on the build for later use in RFP/preview/vendor views | — | [x] | ← impl 2 (`screenshots_json` + resource URLs) |

---

## 5. Templates — Vehicle Templates (`/templates`)

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 5.1 | `/templates` list (use / delete) | [x] | [x] |
| 5.2 | Templates submenu placed **immediately after Vehicle Builds** in nav | [x] | [x] | ← impl 3: collapsible 3-item submenu (Vehicle/RFP/RFQ Templates) after Vehicle Builds; RFP/RFQ are stub pages + routes pending §6/§7 |
| 5.3 | **Save a *completed* build as a Vehicle Template** → shared org-wide (`is_shared`) | [x] | [x] | ← impl 3 (`save-as-template` copies build config server-side) |
| 5.4 | Owner (and Admin/SuperAdmin) can **rename** a template | [x] | [x] | ← impl 3 (`authorizeOwnerOrAdmin`) |
| 5.5 | Owner (and Admin/SuperAdmin) can **delete** a template | [x] | [x] | ← impl 3 tightened destroy to owner/admin |
| 5.6 | Visibility rule: builds private to creator, templates visible to whole org | [x] | [x] | ← impl 3 (builds index + builder scoped to creator) |
| 5.7 | Preview / simulate a template (read-only builder) | [x] | [x] | ← impl 3 (Use Template = new build; Preview = read-only simulate in new tab) |

---

## 6. Templates — RFP Templates

A predefined RFP layout (cover page, executive summary, …). Each section is an **RTF/rich-text editor**;
sections support **placeholders** and **docx/pdf upload/paste**. CRUD + rename + delete.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 6.1 | `rfp_templates` + `rfp_template_sections` tables/models | — | [x] | ← impl 4: shared `document_templates` + `document_template_sections` (kind=RFP) |
| 6.2 | RFP Template list (create / rename / delete) | [x] | [x] | ← impl 4; **create harnesses AI**: name + optional brief → AI drafts section stubs (`JsonExtractor` harmonizer ported from `temp.php`), fallback when AI off |
| 6.3 | Section editor: "+ Add Section", reorder, rename, delete | [x] | [x] | ← impl 4 |
| 6.4 | Rich-text (RTF) editing per section | [x] | — | ← impl 4 (`RichTextEditor`, contentEditable, no new dep) |
| 6.5 | **Placeholder tokens** (org, county, year, vehicle, etc.) insert + resolve | [x] | [x] | ← impl 4 (insert + Preview resolve; full bind at §8/§9 generation) |
| 6.6 | **Upload / paste docx & pdf** into a section | [~] | [~] | ← impl 4: UI button stubbed (disabled); needs parser deps |
| 6.7 | AI summary of each template (used in the RFP wizard selector — §8) | [x] | [x] | ← impl 4 (OpenRouter/Gemini via `AiReasoner`, graceful fallback) |

---

## 7. Templates — RFQ Templates

Same as §6, but for RFQs.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 7.1 | `rfq_templates` + sections tables/models | — | [x] | ← impl 4: shared `document_templates` (kind=RFQ) |
| 7.2 | RFQ Template list (create / rename / delete) | [x] | [x] | ← impl 4 |
| 7.3 | Section editor + RTF + placeholders + docx/pdf upload | [~] | [x] | ← impl 4 (editor/RTF/placeholders done; docx/pdf upload stubbed) |
| 7.4 | AI summary per template | [x] | [x] | ← impl 4 |

---

## 8. RFP Creation Wizard (`/rfps` → Create New RFP)

Multi-step questionnaire modal. Today RFPs are created via a single POST with hardcoded/sample content — the
**wizard does not exist**.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 8.1 | Wizard modal shell with progress + steps | [x] | — | ← impl 5 (4-step `rfp-wizard-dialog`) |
| 8.2 | **Step 1** — title, org info (county prefilled, etc.), year | [x] | [x] | ← impl 5 |
| 8.3 | **Step 2** — select vehicle build: tabbed **From Template** / **From Builds**, thumbnails | [x] | [x] | ← impl 5 (wizard-data endpoint) |
| 8.4 | Build **preview in new tab** + **simulate (read-only) mode** from the selector | [x] | [x] | ← impl 5 (builds `?buildId`, templates `?templateId&preview=1`) |
| 8.5 | **Cart method** — add vehicles with quantities (e.g. Ford Explorer ×6 + others ×N) | [x] | [x] | ← impl 5 |
| 8.6 | **Step 3** — select RFP template, show title + **AI summary**, pick one | [x] | [x] | ← impl 5 (uses impl 4 AI summaries) |
| 8.7 | **Step 4** — "building sections": top progress bar 0–100% (step X of Y), per-step spinner→check (see `screenshots/6bgeneraing-rfp.png`) | [x] | [x] | ← impl 5 (overlay on the document page, polls generation status) |
| 8.8 | Persist wizard selections into the `procurement_request` snapshot (build + qty + template) | [x] | [x] | ← impl 5 (`source_snapshot_json`) |

---

## 9. RFP Document Generation

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 9.1 | Generate document sections from selected template + build snapshot | [x] | [x] | ← impl 5 (`GenerateRfpDocument` job) |
| 9.2 | **AI-generated section content** (real, not hardcoded sample HTML) | [x] | [x] | ← impl 5 (AiReasoner per section, fallback to resolved template text) |
| 9.3 | **Background generation** feeding the §8.7 progress UI | [x] | [x] | ← impl 5: `RfpDocumentGenerator` + per-section `generate-section` endpoint; **client-orchestrated** one section at a time (no queue worker needed) |
| 9.4 | Store editable **HTML** representation for the approval workflow | [x] | [x] |
| 9.5 | **PDF as final output** (export HTML → PDF) | [x] | [x] | ← impl 5 (dompdf, `rfps/document/pdf`) |
| 9.6 | `/rfps/document?document={id}` viewer/editor | [x] | [x] |
| 9.7 | **"Regenerate RFP"** button actually re-runs the generation process (currently simulated) | [x] | [x] | ← impl 5 (real `regenerate` endpoint re-dispatches the job) |

---

## 10. RFP Document Editor & Approval Workflow

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 10.1 | Rich HTML editor (bold/italic/links/images, multi-page) | [x] | [x] |
| 10.2 | Save as draft / download | [x] | [x] |
| 10.3 | Submit for approval → creates `approval_request`, notifies approvers | [x] | [x] |
| 10.4 | Approval state machine (pending → approved / changes_requested) | [x] | [x] |
| 10.5 | **MS-Word-style track-changes review pane** on the right (`screenshots/13btakeaction.png`) | [x] | [x] | ← impl 6: Review Stage panel + Document Activity audit on the doc page (inline accept/reject markers still TODO) |
| 10.6 | **Tracked edits: text removed + added per reviewer** (`screenshots/13dapprovallog.png`) | [x] | [x] | ← impl 6: `approval_actions.diff_json` (word removed/added), shown in the audit pane |
| 10.7 | **Approval log / audit trail** of every reviewer action | [x] | [x] | ← impl 6 (`approval_actions` + ApprovalWorkflow::log) |
| 10.8 | **Multi-level approval** (route through N configured stages — see §12) | [x] | [x] | ← impl 6 (snapshot stages, advance per stage) |
| 10.9 | On full approval, return to originating Fleet Manager | [x] | [x] | ← impl 6 (final stage → approved + notify requester) |
| 10.10 | Fleet Manager **publishes** RFP → published state | [x] | [x] |
| 10.11 | **Published RFP gets its own public URL** + mini public listing (→ §14 vendor portal) | [x] | [x] | ← impl 7 (public `/opportunities` + `/opportunities/{id}`, no login; bidding gated to vendor login) |
| 10.12 | Replace the **simulated** AI review in `approval-review.tsx` with real AI assist | [~] | [ ] |

---

## 11. RFQ Flow (`/rfqs`)

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 11.1 | `/rfqs` list — Draft / Shared tabs, vendor counts | [x] | [x] |
| 11.2 | Create RFQ (type=RFQ) | [x] | [x] |
| 11.3 | Share with vendors (status→published) | [x] | [x] |
| 11.4 | Cancel | [x] | [x] |
| 11.5 | RFQ generation wizard + RFQ templates (mirror §8/§9 for RFQ) | [ ] | [ ] |
| 11.6 | "Track Bids" → vendor-bids | [x] | [x] |

---

## 12. System Setup (Admin / Super Admin)

Configures **how many approval levels** an RFP goes through, and permissions. **Distinct from the Users page.**
Does not exist today.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 12.1 | `/system-setup` page (Admin/SuperAdmin gated) + nav entry | [x] | [x] | ← impl 6 |
| 12.2 | **Approval workflow config** — define ordered approval stages/levels | [x] | [x] | ← impl 6 (`approval_workflow_stages`, add/reorder/role) |
| 12.3 | Persist workflow config (table/model) + consume it in §10.8 routing | [x] | [x] | ← impl 6 (`ApprovalWorkflow::stagesFor` consumed by submit) |
| 12.4 | **Permission configuration** UI (beyond the static `RoleAccess` matrix) | [~] | [~] | ← impl 6: read-only role×permission matrix shown; editable/DB-backed config deferred |

---

## 13. Users (`/users`)

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 13.1 | Users list (Active / Pending Invite), search/filter/sort | [x] | [x] |
| 13.2 | Invite user (email + reset-token link, queued mail) | [x] | [x] |
| 13.3 | Resend / cancel invite | [x] | [x] |
| 13.4 | Change role / remove access | [x] | [x] |
| 13.5 | **Permissions shown read-only** on the users page (spec §6) | [~] | [~] |
| 13.6 | Profile edit (settings) | [x] | [x] |

---

## 14. Vendor Authentication (SEPARATE from main users)

Spec §7: vendors must **not** use the `users` table — separate auth workflow, separate identity, isolated risk.
**Today: nothing exists. Vendor portal routes are public (`Route::inertia`, no middleware), pages use demo
context, and `vendor_bids.vendor_name` is just a string.** This is the single largest greenfield area.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 14.1 | `vendors` table + `Vendor` model (separate from `users`) | — | [x] | ← impl 7 (global, Authenticatable) |
| 14.2 | `vendor` auth guard + provider in `config/auth.php` | — | [x] | ← impl 7 |
| 14.3 | Vendor register / login / password reset (own flow) | [x] | [x] | ← impl 7 (register+login+logout; **password reset deferred**) |
| 14.4 | **Protect all `/vendor/*` routes** with `auth:vendor` | [x] | [x] | ← impl 7 (+ guests → vendor.login) |
| 14.5 | Link `vendor_bids` to `vendor_id` (replace `vendor_name` string) | — | [x] | ← impl 7 (`vendor_id` FK + relation; keeps `vendor_name` for display) |
| 14.6 | Vendor profile (`/vendor/profile`) backed by real data | [x] | [x] | ← impl 7 (editable) |
| 14.7 | Public RFP listing + RFP detail accessible to (or signup gate for) vendors | [x] | [x] | ← impl 7 (public `/opportunities` browsable + downloadable with NO login; "Submit Proposal" gated to vendor login) |

---

## 15. Vendor Portal (vendor-facing)

All pages exist as **demo-context stubs** (`resources/js/vendor/vendor-demo-context.tsx`). They need real
backend props once §14 lands. Screenshots under `screenshots/vendor-dashboard/`.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 15.1 | Vendor dashboard (`a.vendordashboard.png`) | [x] | [x] | ← impl 7 (real counts + opportunities) |
| 15.2 | Browse/open public RFP project details (`a.project-details.png`) + download document | [x] | [x] | ← impl 7 (opportunity detail + vendor PDF) |
| 15.3 | Submit a proposal/bid against an opportunity | [x] | [x] | ← impl 7 (creates `vendor_bid` linked to vendor) |
| 15.4 | My Submissions list (`b.mysubmissions.png`) | [x] | [x] | ← impl 7 (vendor-scoped) |
| 15.5 | Submission detail — 3 scrollable sections (`c.*section1/2/3.png`) | [x] | [x] | ← impl 7 (real detail; simplified vs the 3-section mock) |
| 15.6 | **View configuration in 3D** read-only simulate (`d.view-simulate.png`) — wire `vendor/viewer-placeholder` to the real builder in preview mode | [ ] | [ ] |
| 15.7 | My Awarded Projects — Ongoing / expanded vehicles / Ready-for-Delivery / Completed (`e/f/g.*.png`) | [~] | [ ] |
| 15.8 | Vendor receives notifications on Shortlisted & Awarded | [ ] | [ ] |

---

## 16. Vendor Bids (internal, `/vendor-bids`)

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 16.1 | Bids list + status tabs + vendor directory | [x] | [~] |
| 16.2 | **Status pipeline: Submitted → Recommended → Shortlisted → Awarded** (+ Rejected) | [~] | [~] |
| 16.3 | Status-change notifications | [~] | [~] |
| 16.4 | **Notify the vendor** on Shortlisted / Awarded (depends on §14 vendor identity) | [ ] | [ ] |
| 16.5 | Vendor directory backed by real `vendors` (currently hardcoded) | [ ] | [~] | ← impl 7: bids now carry `vendor_id` → real `Vendor`; surfacing profiles on `/vendor-bids` still TODO |
| 16.6 | Award → create/seed a project tracker for the awarded vehicles | [~] | [~] |

---

## 17. Project Tracker (`/tracker`, `/tracker/workspace`)

Built **frontend-only** with a mock data module (`resources/js/lib/tracker/data.ts`). See `project-tracker.md`.
Quick-action dialogs are toast stubs; photos are CSS placeholders.

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 17.1 | Projects list (Ongoing / Ready / Completed) `16a` | [x] | [~] |
| 17.2 | Project details dialog (multi-vehicle) `16b` | [x] | [~] |
| 17.3 | Workspace: Interior / Exterior parts checklists `16c/16i` | [x] | [ ] |
| 17.4 | Part detail expand: build history + attached photo + full-view preview `16f` | [x] | [ ] |
| 17.5 | Activities / Blockers tab `16g` | [x] | [ ] |
| 17.6 | Milestones / build-stage timeline `16h` | [x] | [ ] |
| 17.7 | Quick actions: Log Issue / Update Stage / Post Activity `16j/k/l` — **persist** (currently toasts) | [~] | [ ] |
| 17.8 | Update part status `16e` — persist | [~] | [ ] |
| 17.9 | Preview vehicle build in builder from tracker `16c` | [~] | [~] |
| 17.10 | Photo upload + storage (S3) for activities/parts | [ ] | [ ] |
| 17.11 | Replace mock data module with Inertia props / real models | [~] | [ ] |
| 17.12 | Wire `?project=&vehicle=` so workspace resolves the actual vehicle (currently hardcoded Ford Explorer) | [~] | [ ] |

---

## 18. Notifications

| SN | Task | Frontend | Backend |
|----|------|:--------:|:-------:|
| 18.1 | Notifications page (All / Unread / Approvals / Vendor Activity) | [x] | [x] |
| 18.2 | Mark read / mark all read | [x] | [x] |
| 18.3 | Notifications generated by procurement/approval/bid status changes | [x] | [x] |
| 18.4 | **Vendor-targeted notifications** (separate from org notifications) — depends on §14 | [ ] | [ ] |
| 18.5 | Notification bell / unread count in header | [~] | [~] |

---

## 19. Cross-cutting capabilities (enablers)

These unblock multiple sections; track them explicitly so nothing is silently skipped.

| SN | Task | Frontend | Backend | Blocks |
|----|------|:--------:|:-------:|--------|
| 19.1 | S3 disk + signed URLs | — | [x] | §4, §15.6, §17.10 | ← impl 2: live S3 (adapter installed, `temporaryUrl` signed URLs verified) |
| 19.2 | Local 300×300 thumbnail pipeline | — | [x] | §4.1 | ← impl 1 (client-side resize + `storeThumbnail`; no server image lib added) |
| 19.3 | three.js screenshot orchestration (multi-angle + per-item, with preloader) | [x] | — | §4.3–4.6 | ← impl 2 |
| 19.4 | HTML→PDF export | — | [ ] | §9.5, §15.2 |
| 19.5 | AI service wrapper (summaries + section generation) | — | [x] | §6.7, §7.4, §8.6, §9.2, §10.12 | ← `App\Services\Ai\AiReasoner` (OpenRouter/Gemini, OpenAI-compatible); `isConfigured()` guard + graceful degrade; live-verified |
| 19.6 | docx/pdf import → editor content | — | [ ] | §6.6 |
| 19.7 | Read-only "simulate/preview" builder mode reachable by URL (new tab) | [~] | [~] | §2.8, §5.7, §8.4, §15.6 |
| 19.8 | Track-changes diff engine (store + render add/remove per reviewer) | [ ] | [ ] | §10.5–10.7 |
| 19.9 | Background job infrastructure (queue) for generation + screenshots | — | [~] | §4.6, §9.3 |

---

## Suggested implementation order

1. **Builder CTA rework + lifecycle** (§3.4–3.10) + **draft thumbnail** (§4.1–4.2, §19.2) — small, high-visibility, unblocks builds UX.
2. **Complete-build screenshots + S3** (§4.3–4.7, §19.1, §19.3).
3. **Vehicle Templates polish** (§5) — rename, save-from-completed, sharing, preview.
4. **RFP/RFQ Templates** (§6, §7) — RTF sections, placeholders, uploads, AI summaries (§19.5, §19.6).
5. **RFP Wizard + generation** (§8, §9) including PDF (§19.4) and background jobs (§19.9).
6. **Track-changes approvals + System Setup** (§10.5–10.8, §12, §19.8).
7. **Vendor auth + portal wiring** (§14, §15, §16.4) — largest greenfield, do as a focused block.
8. **Tracker backend** (§17) — replace mock module, persist actions, photo uploads.

### Required Documents + AI bid scoring + shortlist/award (§10 in projectlogic) — ← impl 8 (done)

| # | Item | Backend | Frontend | Notes |
|---|------|---------|----------|-------|
| 10a | Wizard "Required Documents" step (Document / Questionnaire / Textarea + default RFP Response) | [x] | [x] | ← impl 8 |
| 10b | System-computed requirement **weights** at RFP creation | [x] | n/a | `RequiredDocumentWeights`, stored in snapshot |
| 10c | Vendor response: draft / update-until-deadline / submit / **withdraw** | [x] | [x] | `vendor_bid_documents`; withdraw blocked once awarded |
| 10d | AI **scan + score** each document 0–100 + **weighted accumulated** score | [x] | n/a | `DocumentTextExtractor` + `BidScorer`, inline on submit |
| 10e | `/vendor-bids` Recommended ordered by score + **scorecard modal** | [x] | [x] | per-doc score/weight/rationale |
| 10f | **Shortlist** notifies vendor (in-app + email) | [x] | [x] | `VendorShortlistedNotification` |
| 10g | **Award** via multi-stage approval workflow → Awarded + vendor notified | [x] | [x] | `ApprovalRequest` type `Contract Award` |
| 10h | Vendor `awarded-projects` Ongoing = real (name/customer/vehicle count) | [x] | [x] | other tabs/dropdown stay stub |

### RFQ pipeline (full RFQ counterpart) — ← impl 9 (done)

| # | Item | Backend | Frontend | Notes |
|---|------|---------|----------|-------|
| 9a | Vendor Categories / Locations config (System Setup, per-org) | [x] | [x] | ← impl 9 |
| 9b | Vendor Preferences (categories + locations multi-select) | [x] | [x] | global vendor ↔ org rows |
| 9c | RFQ wizard (title/desc → categories → locations → editable AI summary) | [x] | [x] | `RfqWizardController` |
| 9d | RFQ generation (AI-invents sections from summary) + approval | [x] | [x] | `RfqDocumentGenerator`, reuses doc page + named-approver approval |
| 9e | `/rfqs` tabs Draft · Pending Approval · Approved · Shared With Vendors | [x] | [x] | |
| 9f | Share With Vendors (ranked auto-check, searchable, configurable N, notify) | [x] | [x] | `VendorQualification`, `rfq_invitations`, `VendorRfqInvitedNotification` |
| 9g | Vendor My RFQs → respond (self-defined items) → AI scoring | [x] | [x] | `RfqScorer` (6 fixed criteria), `score_breakdown_json` |
| 9h | Vendor Quotes (Submitted/Shortlisted/Compare/Awarded) + scorecards + compare | [x] | [x] | reuses vendor-bid status/award |
| 9i | Menu: Vendor Bids under RFPs, Vendor Quotes under RFQs; project filters | [x] | [x] | |

> Nothing here is deleted from the existing system — most work is *deepening* stubs into real behaviour and
> filling the genuinely-missing modules (templates ×2, RFP wizard, System Setup, vendor auth, tracker backend).
