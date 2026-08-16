# 03 — Vendor Team & Access

**Bucket:** §20.3 · **Depends on:** vendor 01 · **Blocks:** vendor 04, 09 · **Size:** M
**Spec:** §75 (authentication), §76 (organizations — the membership pattern this copies), §77 (role modelling), §88 (server-side authorization), §90 (audit)

## Why
A vendor is rarely one person. The developer who ships a release, the person who
answers support, and the person whose bank account receives the money are
usually three different people, and giving all three the same access means the
payout details are editable by whoever is on call.

## Scope

### Membership

```ts
interface VendorMemberDoc {
  vendorId: Types.ObjectId;
  userId: Types.ObjectId;
  role: VendorRole;
  status: "invited" | "active" | "revoked";
  invitedByUserId?: Types.ObjectId;
  acceptedAt?: Date;
}
```

Unique on `(vendorId, userId)`, mirroring `OrganizationMember`.

### Four roles, and why they are not the organization roles

`ORGANIZATION_ROLES` is `owner | admin | billing | technical | member` and every
one of them is **buyer-shaped** — they describe who may spend, who receives an
invoice, who downloads. A vendor's roles describe who may *sell*, and the two
sets happen to share words while meaning different things. Reusing them would
make `role: "billing"` mean "receives invoices" in one collection and "receives
payouts" in another.

| Role | May |
|---|---|
| `owner` | Everything, including payout details, agreement acceptance, and removing members. Exactly one per vendor; transferable, never absent |
| `manager` | Products, submissions, storefront, support. Not payout details, not membership |
| `developer` | Product content and releases. Not pricing, not support, not money |
| `finance` | Payout details, statements, earnings. Not products |

`developer` deliberately cannot set a price and `finance` deliberately cannot
touch a product: the two capabilities that most need separating are the one that
decides what a customer pays and the one that decides where the money goes.

### Enforcement

`requireVendorRoleOrForbid(roles)`, alongside vendor ticket 01's
`requireVendor()` and following the DAL's existing shape —
`requireOrgRoleOrForbid` is the direct precedent.

Every vendor server action calls it. A server action is a public POST endpoint,
and a hidden button is not a permission check; `action-guards.test.ts` walks
every action and will fail on a vendor action that reaches no guard, which is
the mechanism rather than the convention.

### Invitations

Email invitation carrying a signed token, an expiry, and the role. Accepting
requires a verified email — the platform's own rule (§75) and more so here,
because the invitee is about to reach a payout account.

An invitation to somebody who already has an account attaches the membership on
acceptance; one to a new address carries them through registration first. The
invited user's *customer* organizations are untouched, because the two
memberships are unrelated.

### The owner is never absent

Removing the last owner is refused. Transfer is an explicit action, audited, and
notifies both parties — an account with no owner has payout details nobody may
change and no one who can accept a new agreement version.

## Out of scope
Per-product access within a vendor. A `developer` reaches all of that vendor's
products; splitting further is a permission model with no demand behind it yet.

## Acceptance criteria
- [ ] A vendor has exactly one owner at all times, and removing the last one is refused.
- [ ] A `developer` cannot change a price or view payout details, in the action and not only in the UI.
- [ ] A `finance` member cannot edit a product.
- [ ] Every vendor server action reaches `requireVendorRoleOrForbid`, and the guard-coverage test proves it rather than a reviewer.
- [ ] An invitation expires, and an expired one cannot be accepted.
- [ ] An invitation cannot be accepted by a different email than the one it was sent to.
- [ ] Accepting an invitation does not change any of the accepting user's customer organization memberships.
- [ ] A revoked member loses access on their next request, without needing to sign out.
- [ ] Membership changes and ownership transfers are audited with both parties named.
- [ ] A member of vendor A cannot read or write anything belonging to vendor B, asserted in the tenant-isolation suite alongside the organization cases.
