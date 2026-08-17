# 01 — Vendor Identity & Onboarding

**Bucket:** §20.1 · **Depends on:** tickets 03, 20 · **Blocks:** vendor 02–13 · **Size:** L
**Spec:** §76 (organizations — the buyer-shaped entity a vendor is *not*), §77 (staff roles — who reviews an application), §90 (audit), §91 (state machines), §106.31 (decisions needing stakeholder input)

## Why
The spec has no vendors in it. Not one occurrence of vendor, seller, partner or
supplier in 3,521 lines; §107's vision is "one coherent operating system through
which **Innovatrix** sells software". So this ticket adds a second party to a
platform designed with one, and every ticket after it depends on the identity
established here. Everything downstream — product ownership, earnings, payouts —
needs something to hang off, and today there is nothing.

## Read first
`src/lib/auth/dal.ts`, and the docblock in `src/lib/auth/permissions.ts` stating
that organization roles and staff permissions "never mix". A vendor is a third
kind of principal, and understanding why the existing two do not stretch to
cover it is most of this ticket.

## Scope

### A `Vendor` model, not an `Organization`

`Organization` is the obvious reuse and the wrong one. It is buyer-shaped —
`billingAddress`, `taxId`, `customerSince`, `isPersonal` — and it is **half-owned
by Better Auth's raw MongoDB driver**, so Mongoose defaults never fire on it,
`required: true` is a trap, and any field that will be filtered on must also be
declared in Better Auth's `additionalFields`. Adding payout bank details there
puts a receivable identity inside a document that is otherwise purely a payer.

A `Vendor` collection instead, keyed to a `User` for authentication:

```ts
interface VendorDoc {
  _id: Types.ObjectId;
  slug: string;                       // the storefront URL — immutable once verified
  displayName: string;
  legalName?: string;
  contactEmail: string;
  country: string;
  status: VendorStatus;
  appliedAt: Date;
  verifiedAt?: Date;
  suspendedAt?: Date;
  suspensionReason?: string;
  /** Which version of the vendor agreement was accepted, and when. */
  agreement?: { version: string; acceptedAt: Date; acceptedByUserId: Types.ObjectId };
  profile: { summary?: string; websiteUrl?: string; supportEmail?: string; logoKey?: string };
}
```

A user may be a customer **and** a vendor. Nothing about being one implies the
other, and neither scope leaks into the other.

**A user belongs to at most one vendor.** Not a technical limit — a deliberate
one, and the thing that keeps this feature comprehensible. The alternative needs
a vendor switcher in the chrome, and the customer shell already carries an
`OrgSwitcher`; a second switcher beside it means every screen has to answer "as
whom am I acting" before it answers anything else. Enforced by index in vendor
ticket 03, and revisitable later without a data migration.

### The state machine

A new entry in `STATE_MACHINES`, so `STATES.md` documents it for free:

```
applied → in_review → verified → suspended → verified
                   ↘ rejected              ↘ offboarded
```

`rejected` and `offboarded` are terminal. `suspended` is reversible because a
suspension is usually a dispute, not an ending — vendor ticket 12 covers what
each state means for products already on sale.

### Applying (`/dashboard/selling/apply`)

**Applying is an authenticated action, not a public form.** The applicant is
already a signed-up user: they have a verified email the platform trusts, a user
id to hang the owner membership off, and a session to audit the agreement
acceptance against. A public form would have to collect an identity the platform
already holds and then reconcile the two.

The form itself: display name, country, what they build, a support email, and
acceptance of the current vendor agreement version. The contact email defaults to
the account's own. Submitting creates the `Vendor` in `applied` **and** its owner
`VendorMember` in one transaction (vendor ticket 03) and nothing else — no
products, no storefront, no slug reservation beyond uniqueness.

A public `/sell` marketing page may sit in front of it, pointing a signed-out
visitor at registration. That page is content, not a form.

Whether applications are open or invite-only is decision **V11**; the flow is
built either way, and an invite gate in front of it is a flag.

### A section of the customer shell, not a fourth one (`/dashboard/selling`)

There are exactly three shells today — `(public)`, `dashboard`, and
`admin`+`staff`. A vendor is a third *principal*: `requireOrg()` establishes
customer tenancy, `requireStaff()` establishes platform staff, and neither
stretches to cover selling.

But a new principal does not require a new shell, and **vendor 01 originally
conflated the two**. Every vendor is a signed-up user with a personal
organization, so every vendor already has `/dashboard`; giving them a second
portal means learning which one they are in before they can do anything. So:

- a `selling` segment **inside** the customer shell, with its own nested layout,
- a "Selling" navigation group that is drawn only for a user who has a vendor,
- and a new DAL guard, which is the part that actually enforces scope.

```ts
requireVendor(): Promise<VendorContext>        // any active member; redirects when there is none
requireVendorOrForbid(): Promise<VendorContext>
requireVendorOwner(): Promise<VendorContext>   // vendor ticket 03
```

`VendorContext` carries `{ user, vendor, vendorId, role }`. Following the DAL's
existing convention: a layout redirects, a page forbids, an action throws. A
vendor whose status is not `verified` reaches only the application-status screen.

The nesting is a routing decision and nothing more. `requireOrg()` in the
enclosing layout gives the segment a customer context it does not use, which is
harmless — it is an extra fact, not a wrong one — and **no vendor screen may take
its scope from it**. Scope comes from `requireVendor()`, every time. Moving the
segment to a top-level `/vendor` later is a redirect, not a rewrite.

### Three things that need a new *kind*, not a new row

Most of the platform extends by adding a row to a map. These do not, and each
is a small edit that is easy to miss:

- **`AuditActor` has no vendor variant.** A vendor editing their own product
  would today be recorded as `customer`, which is wrong in the one collection
  that exists to be trustworthy later. Add `{ type: "vendor"; vendorId; userId }`.
- **`SUBJECT_TYPES` is a closed union** and has no `vendor`. Without it, an
  audit row about a vendor cannot be found by the subject-scoped index.
- **`requireVendor()`**, above.

### Staff review (`staff/queue/vendor-applications`)

`QUEUES` in `src/features/staff/queues.ts` is a declarative registry and takes a
new key. Reviewing an application means approve → `in_review` (handing to vendor
ticket 02's verification) or reject with a reason the applicant sees.

Gated on a new `vendor.review` permission. The permission matrix is exhaustive —
`assertMatrixIsComplete()` fails the suite if a role has no explicit entry — so
adding vendor permissions forces a decision for all eleven roles rather than
allowing a default.

### Events and notifications

`VendorApplied`, `VendorVerified`, `VendorRejected`, `VendorSuspended` on the
event bus, with catalogue rules for each. A new `{ kind: "vendor_member" }`
audience resolves to that vendor's active members — which for most vendors is one
person, and is the same audience either way.

Note there are **two drifted event lists**: `DomainEventMap` in
`src/lib/events/index.ts` and `DOMAIN_EVENTS` in `src/lib/db/enums.ts`, which
disagree today. A vendor event needs the first to be emitted and the second to
appear on an activity timeline.

## Out of scope
Verification documents and levels are vendor ticket 02; invitations and the
second role are vendor ticket 03. This ticket establishes one vendor with one
owning user — which is also the shape most vendors keep.

## Acceptance criteria
- [ ] A `Vendor` exists as its own collection, and no field was added to `Organization`.
- [ ] A user who is both a customer and a vendor reaches both sets of screens, and neither scope leaks into the other.
- [ ] The "Selling" navigation group is drawn only for a user who has a vendor, and its absence protects nothing — the DAL does.
- [ ] No vendor screen derives its scope from the enclosing shell's `requireOrg()`; every one calls `requireVendor()`.
- [ ] The vendor state machine is registered in `STATE_MACHINES` and appears in the generated `STATES.md`.
- [ ] An illegal transition throws rather than writing, like every other machine in the platform.
- [ ] `requireVendor()` redirects a user with no vendor record to `/dashboard/selling/apply`.
- [ ] A vendor whose status is `applied`, `in_review`, `rejected` or `suspended` cannot reach any vendor screen except their application status.
- [ ] `/dashboard/selling` is unreachable by a signed-out visitor, a customer with no vendor record, and a staff member with no vendor record.
- [ ] Applying is refused for a signed-out visitor and for a user who already belongs to a vendor.
- [ ] Applying creates the vendor and its owner membership in one transaction, and records the accepted agreement version and the user who accepted it.
- [ ] A staff member with `vendor.review` sees applications in a queue; one without gets a 403 on the page and a throw from the action.
- [ ] Approving and rejecting both write an audit row with a `vendor` actor and a `vendor` subject.
- [ ] The permission matrix test passes, which requires every one of the eleven staff roles to have an explicit answer for the new permissions.
- [ ] `VendorApplied` and `VendorVerified` reach their audiences, and no notification reaches a vendor who is not a member of that vendor.
