# 18 — AI Custom-Build Assistant

**Bucket:** §10.10–10.13 · **Depends on:** 16, 08 · **Blocks:** 19 · **Size:** M
**Spec:** §21 (custom build journey), §22 (assistant), §23 (feature suggestions), §24 (marketplace recommendation), §25

## Why
This serves the customer who arrives with a business problem and no idea what software solves it — "I need
software to manage my cleaning company" (§1). §22 sets the rule: **understand the problem, not the technology.**

## Scope

### Entry `/custom-software`
A public marketing page explaining the process, then "Start" → `aiConversation` with
`contextType: 'custom_build'`. No login required to start; login required to submit.

### Interview (§22)
Open with the business, never the stack. The §22 question set is the backbone:
what are you trying to achieve · who will use it · what do you use today · what problems are you having ·
what should users be able to do · will your customers use it directly · do you need payments · do you need
reports · does it need to work on mobile · do you already have a website or software.

**Vocabulary rule (§100):** no "REST API", "schema", "deployment architecture" unless the customer raises it.
Translate internally; ticket 20 gives staff the technical interpretation surface.

### Feature suggestions (§23)
From the business context, propose relevant features as an **explicit checklist** the customer accepts or
rejects — the §23 care-agency example (staff profiles, shift scheduling, client records, timesheets, payroll
integration, mobile access, notifications, reporting). The customer may accept, reject, ask about, or add their
own.
**Suggestions never silently become requirements** (§23) — unaccepted items are recorded as suggestions only,
and the summary shows the distinction.

### Marketplace recommendation (§24)
Before finalising, search the marketplace against the accumulated requirements (reuse ticket 08's search:
keyword + category/industry matching over the requirement text). If there are strong candidates, present them:

```
Innovatrix already has two products that may provide most of what you need.
[View Existing Solutions]   [Continue With Custom Build]
```
- Show what each candidate covers and, honestly, what it doesn't.
- **Never force the marketplace option** (§24). "Continue with custom build" is always equally available and
  never buried.
- Record which recommendations were shown and what the customer chose — that is a valuable business signal.
- If the customer picks a product, hand them to that product page, or straight into the ticket-17 customization
  assistant carrying everything gathered so far. **Do not make them start over.**

### Project brief & submission (§25)
Produce a structured brief: business context · users and roles · core capabilities (confirmed) · suggested but
not confirmed · integrations · reporting · platforms · deployment/hosting needs · timeline · budget range if
volunteered · notes. Editable, same Edit / Continue / Submit actions as ticket 17.

On submit: generate `REQ-YYYY-NNNN`, create a `customerRequest` with `kind: 'custom_build'`, link the
conversation, record recommended-products-shown and the customer's choice, emit `RequestSubmitted`, redirect to
the dashboard request page (§25).

## Acceptance criteria
- [ ] Given "I want a platform for managing a care agency", the assistant asks about the business and proposes
      the §23-style feature checklist rather than asking about technology.
- [ ] Rejected suggestions do not appear as requirements in the brief.
- [ ] A requirement set matching a seeded marketplace product triggers the §24 recommendation.
- [ ] Choosing "Continue With Custom Build" proceeds with no friction, nagging, or repeated prompting.
- [ ] Choosing an existing product carries the gathered requirements into the customization flow — nothing is
      re-asked.
- [ ] The brief contains no technical jargon the customer didn't introduce.
- [ ] A submitted request appears on the dashboard with its reference and in the staff queue.
- [ ] The assistant declines to estimate cost or duration, explaining a quote will follow review (§73).
- [ ] Shown recommendations and the customer's choice are recorded on the request.
