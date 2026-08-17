# 03 — Vendor Team & Access

**Bucket:** §20.3 · **Depends on:** vendor 01 · **Blocks:** vendor 04, 09 · **Size:** S
**Spec:** §75 (authentication), §76 (organizations — the membership pattern this copies), §77 (role modelling), §88 (server-side authorization), §90 (audit)

## Why
A vendor is usually one person and occasionally a small team, and this ticket has
to serve both without making the common case walk through the rare one. The
separation that matters is narrow: the person who ships a release and the person
whose bank account receives the money need not be the same person, and payout
details must not be editable by whoever is on call.

Everything past that separation is a policy nobody has asked for yet.

## Scope

### Membership

```ts
interface VendorMemberDoc {
  vendorId: Types.ObjectId;
  userId: Types.ObjectId;
  role: VendorRole;                 // "owner" | "member"
  status: "invited" | "active" | "revoked";
  invitedByUserId?: Types.ObjectId;
  acceptedAt?: Date;
}
```

Unique on `(vendorId, userId)`, mirroring `OrganizationMember`. Also unique on
`userId` alone among non-revoked rows: **a user belongs to at most one vendor**
(vendor ticket 01). That constraint is what removes the vendor switcher from the
shell, and the shell already carries an `OrgSwitcher` — a second one beside it is
the confusion this whole refinement exists to avoid.

### Two roles

| Role | May |
|---|---|
| `owner` | Everything: payout details, agreement acceptance, membership, plus all of `member`. Exactly one per vendor; transferable, never absent |
| `member` | Products, versions, releases, submissions, storefront content, support and dispute threads, and **reading** earnings. Not payout details, not the agreement, not membership |

Only one separation is load-bearing here, and it is **where the money goes**. A
wrong price is reversible and audited; a wrong bank account is money in a
stranger's hands. So `owner` holds the payout account, the agreement, and the
membership list, and `member` holds everything else.

Finer splits — a role that may edit a product but not price it, or see earnings
but not products — were considered and dropped. Each multiplies the
(role × action) cases that every action, screen and test has to answer, for a
principal that is usually a single person, and none of them has a vendor asking
for it. A third role is additive later: the guard signature below does not change
to accommodate one.

### Not the organization roles, and not their names either

`ORGANIZATION_ROLES` is `owner | admin | billing | technical | member` and every
one of them is **buyer-shaped** — they describe who may spend, who receives an
invoice, who downloads. A vendor's roles describe who may *sell*.

The overlap is worse than duplication: a role called `billing` on an
organization and one called `finance` on a vendor would be two different money
things in two collections, and `owner` would mean two different things depending
on which document the reader is holding. Two vendor roles, one of which is
`member`, keeps the vocabulary small enough that the collision is obvious rather
than subtle.

### Enforcement — one guard, one boolean

```ts
requireVendor(): Promise<VendorContext>          // any active member (vendor 01)
requireVendorOwner(): Promise<VendorContext>     // owner only
```

Two functions, following the DAL's existing shape — `requireOrgRoleOrForbid` is
the precedent, and this is the degenerate case of it. "Who may do this" fits in
the function name rather than a set literal repeated at each call site.

Every vendor server action calls one of them. A server action is a public POST
endpoint, and a hidden button is not a permission check; `action-guards.test.ts`
walks every action and will fail on a vendor action that reaches no guard, which
is the mechanism rather than the convention. With a boolean instead of a
four-role set it enumerates two cases per action rather than four.

### Solo is the default path, not a degenerate case

- Applying (vendor ticket 01) creates the `Vendor` **and** its owner
  `VendorMember` in one transaction. A solo vendor is a vendor with one member,
  never a vendor with none — so no downstream code branches on "has a team".
- Onboarding has no team step, no seat count, and no "invite your team" prompt.
- The team screen lives in vendor settings, reachable but never advertised: not
  in the navigation, no badge, no empty-state nag. A one-person vendor can list,
  sell, get paid, answer reviews and run a dispute without ever opening it.

### Invitations, on the rails that exist

Better Auth owns organization invitations — `getAuth().api.acceptInvitation`,
backed by `OrganizationInvitationDoc` — and they are org-scoped. A vendor is
deliberately not an `Organization` (vendor ticket 01), so that flow cannot be
reused as it stands.

The layer underneath it can be. The `Verification` collection already exists for
"single-use tokens: email verification, password reset, invitation lookups", and
`src/lib/crypto.ts` already holds the signing primitives. A vendor invitation is
therefore a `Verification` row carrying the vendor, the role and an expiry, plus
an email, accepted through a second branch on the existing `/accept-invite`
page — not a parallel invitation subsystem with its own token scheme.

Backing a `Vendor` with an `Organization` to inherit membership for free was
considered and rejected: it puts the vendor in the customer org switcher and
re-imports the buyer-shaped role names. The complexity it saves in code it
spends in the UI.

Accepting requires a verified email — the platform's own rule (§75), and more so
here, because an invitee may be one promotion away from the payout account. An
invitation to somebody who already has an account attaches the membership on
acceptance; one to a new address carries them through registration first. The
invited user's *customer* organizations are untouched, because the two
memberships are unrelated.

An invitation is refused where the invitee already belongs to another vendor —
the one-vendor-per-user constraint, enforced at acceptance and not only at send,
because the invitee's situation may have changed in between.

### The owner is never absent

Removing the last owner is refused. Transfer is one explicit action — promote a
member, demote yourself — audited, and notifying both parties. An account with no
owner has payout details nobody may change and nobody who can accept a new
agreement version.

## Out of scope
Per-product access within a vendor: a `member` reaches all of that vendor's
products. Multiple owners. A third role — added when a vendor asks, not before.

## Acceptance criteria
- [ ] A vendor has exactly one owner at all times, and removing the last one is refused.
- [ ] Applying creates the vendor and its owner membership in one transaction; no vendor ever exists without an owner.
- [ ] A `member` cannot view or change payout details, accept an agreement version, or invite anybody — in the action, not only in the UI.
- [ ] A `member` can read earnings, so a balance change is answerable without the owner.
- [ ] A user belongs to at most one vendor, enforced by index, and an invitation to somebody who already belongs to one is refused at acceptance.
- [ ] Every vendor server action reaches `requireVendor` or `requireVendorOwner`, and the guard-coverage test proves it rather than a reviewer.
- [ ] A one-person vendor can complete onboarding, list, submit, sell and be paid without loading the team screen.
- [ ] An invitation expires, and an expired one cannot be accepted.
- [ ] An invitation cannot be accepted by a different email than the one it was sent to, and the accepting email is verified.
- [ ] Accepting an invitation does not change any of the accepting user's customer organization memberships.
- [ ] A revoked member loses access on their next request, without needing to sign out.
- [ ] Membership changes and ownership transfers are audited with both parties named.
- [ ] A member of vendor A cannot read or write anything belonging to vendor B, asserted in the tenant-isolation suite alongside the organization cases.
