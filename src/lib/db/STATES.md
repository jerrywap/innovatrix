# State machines

> **Generated from `src/lib/db/states.ts` — do not edit by hand.**
> Run `npm run db:docs` after changing a transition map.

Spec §91: *"State transitions must be validated server-side."* The maps in
`states.ts` are that validation. `assertTransition()` is the only sanctioned
way to change a status field — a service writing `{ $set: { status } }`
directly has bypassed the machine, and that is a review failure.

A state with no outgoing transitions is **terminal**. No machine allows a
state to transition to itself: re-entering a state would hide a double-write,
which for `order.paid` means fulfilling twice.

## product

| From | To | |
|---|---|---|
| `draft` | `submitted` · `internal_review` · `archived` |  |
| `submitted` | `internal_review` · `changes_requested` · `draft` · `archived` |  |
| `changes_requested` | `submitted` · `draft` · `archived` |  |
| `internal_review` | `testing` · `changes_requested` · `draft` · `archived` |  |
| `testing` | `ready` · `internal_review` · `archived` |  |
| `ready` | `published` · `testing` · `archived` |  |
| `published` | `deprecated` · `archived` |  |
| `deprecated` | `published` · `archived` |  |
| `archived` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> submitted
    draft --> internal_review
    draft --> archived
    submitted --> internal_review
    submitted --> changes_requested
    submitted --> draft
    submitted --> archived
    changes_requested --> submitted
    changes_requested --> draft
    changes_requested --> archived
    internal_review --> testing
    internal_review --> changes_requested
    internal_review --> draft
    internal_review --> archived
    testing --> ready
    testing --> internal_review
    testing --> archived
    ready --> published
    ready --> testing
    ready --> archived
    published --> deprecated
    published --> archived
    deprecated --> published
    deprecated --> archived
```

## productVersion

| From | To | |
|---|---|---|
| `draft` | `released` |  |
| `released` | `deprecated` |  |
| `deprecated` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> released
    released --> deprecated
```

## order

| From | To | |
|---|---|---|
| `draft` | `awaiting_payment` · `cancelled` |  |
| `awaiting_payment` | `paid` · `cancelled` |  |
| `paid` | `fulfilled` · `refunded` |  |
| `fulfilled` | `refunded` |  |
| `cancelled` | — | **terminal** |
| `refunded` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> awaiting_payment
    draft --> cancelled
    awaiting_payment --> paid
    awaiting_payment --> cancelled
    paid --> fulfilled
    paid --> refunded
    fulfilled --> refunded
```

## payment

| From | To | |
|---|---|---|
| `pending` | `succeeded` · `failed` · `requires_review` |  |
| `requires_review` | `succeeded` · `failed` |  |
| `succeeded` | `refunded` |  |
| `failed` | `pending` |  |
| `refunded` | — | **terminal** |

```mermaid
stateDiagram-v2
    pending --> succeeded
    pending --> failed
    pending --> requires_review
    requires_review --> succeeded
    requires_review --> failed
    succeeded --> refunded
    failed --> pending
```

## request

| From | To | |
|---|---|---|
| `draft` | `submitted` · `cancelled` |  |
| `submitted` | `under_review` · `cancelled` |  |
| `under_review` | `waiting_for_customer` · `technical_review` · `quoted` · `rejected` · `cancelled` |  |
| `waiting_for_customer` | `under_review` · `cancelled` |  |
| `technical_review` | `under_review` · `quoted` · `rejected` |  |
| `quoted` | `approved` · `rejected` · `under_review` |  |
| `approved` | `converted` · `cancelled` |  |
| `converted` | `in_progress` · `cancelled` |  |
| `in_progress` | `delivered` · `cancelled` |  |
| `delivered` | `completed` · `in_progress` |  |
| `completed` | — | **terminal** |
| `rejected` | — | **terminal** |
| `cancelled` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> submitted
    draft --> cancelled
    submitted --> under_review
    submitted --> cancelled
    under_review --> waiting_for_customer
    under_review --> technical_review
    under_review --> quoted
    under_review --> rejected
    under_review --> cancelled
    waiting_for_customer --> under_review
    waiting_for_customer --> cancelled
    technical_review --> under_review
    technical_review --> quoted
    technical_review --> rejected
    quoted --> approved
    quoted --> rejected
    quoted --> under_review
    approved --> converted
    approved --> cancelled
    converted --> in_progress
    converted --> cancelled
    in_progress --> delivered
    in_progress --> cancelled
    delivered --> completed
    delivered --> in_progress
```

## quote

| From | To | |
|---|---|---|
| `draft` | `issued` |  |
| `issued` | `accepted` · `rejected` · `expired` · `superseded` |  |
| `accepted` | — | **terminal** |
| `rejected` | `superseded` |  |
| `expired` | `superseded` |  |
| `superseded` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> issued
    issued --> accepted
    issued --> rejected
    issued --> expired
    issued --> superseded
    rejected --> superseded
    expired --> superseded
```

## invoice

| From | To | |
|---|---|---|
| `draft` | `issued` · `cancelled` |  |
| `issued` | `partially_paid` · `paid` · `overdue` · `cancelled` |  |
| `partially_paid` | `paid` · `overdue` · `cancelled` |  |
| `overdue` | `partially_paid` · `paid` · `cancelled` |  |
| `paid` | `refunded` |  |
| `cancelled` | — | **terminal** |
| `refunded` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> issued
    draft --> cancelled
    issued --> partially_paid
    issued --> paid
    issued --> overdue
    issued --> cancelled
    partially_paid --> paid
    partially_paid --> overdue
    partially_paid --> cancelled
    overdue --> partially_paid
    overdue --> paid
    overdue --> cancelled
    paid --> refunded
```

## vendor

| From | To | |
|---|---|---|
| `applied` | `in_review` · `rejected` |  |
| `in_review` | `verified` · `rejected` |  |
| `verified` | `suspended` · `offboarded` |  |
| `suspended` | `verified` · `offboarded` |  |
| `rejected` | — | **terminal** |
| `offboarded` | — | **terminal** |

```mermaid
stateDiagram-v2
    applied --> in_review
    applied --> rejected
    in_review --> verified
    in_review --> rejected
    verified --> suspended
    verified --> offboarded
    suspended --> verified
    suspended --> offboarded
```

## payout

| From | To | |
|---|---|---|
| `draft` | `approved` · `cancelled` |  |
| `approved` | `sending` · `cancelled` |  |
| `sending` | `paid` · `failed` |  |
| `failed` | `approved` · `cancelled` |  |
| `paid` | — | **terminal** |
| `cancelled` | — | **terminal** |

```mermaid
stateDiagram-v2
    draft --> approved
    draft --> cancelled
    approved --> sending
    approved --> cancelled
    sending --> paid
    sending --> failed
    failed --> approved
    failed --> cancelled
```
