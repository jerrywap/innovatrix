# 28 — Testing Strategy & CI/CD

**Bucket:** §19 · **Depends on:** 00 (harness), then all · **Blocks:** launch · **Size:** L
**Spec:** §96 (testing strategy), §97 (CI/CD)

## Why
§96 names four critical journeys. Every one of them crosses money, entitlement or contract boundaries, which is
exactly where a silent regression is most expensive. Build the harness in ticket 00 and add tests **with** each
feature ticket; this ticket owns the harness, the E2E journeys, and the gate.

## Scope

### Unit (Vitest) — §96 "business logic"
Priority targets, all pure and fast:
- Money arithmetic, currency mismatch, formatting per currency (ticket 00).
- Reference generation, including concurrency (ticket 00).
- State-machine transition maps — every allowed transition passes, a sample of disallowed ones throws
  (tickets 02/19).
- Entitlement rules: `canDownload` across purchased version, in-window version, out-of-window version,
  revoked entitlement (ticket 14).
- Cart totals: discounts, tax, add-ons, rounding (ticket 10).
- Permission matrix: role → permission resolution (ticket 03).
- Licence key generation: uniqueness, format, checksum.

### Integration — §96 "database and external boundaries"
- Run against an ephemeral MongoDB (`mongodb-memory-server` **with a replica set** so transactions work, or a
  disposable Atlas database). Reset between tests; seed with factories, not fixtures copied by hand.
- Cover: repositories (including the org-scoping guard), transactional flows (checkout, fulfilment,
  quote acceptance), and the tenant-isolation suite from ticket 26.
- **Payment webhooks**: recorded fixture payloads per provider for success, failure, refund, replay and
  tampered-signature. This is the highest-value integration suite in the project.
- AI: mock the Anthropic client. Test the structured-extraction path against recorded responses, the malformed
  response path, the refusal path, and the provider-down degradation path. **Never call the live API in CI.**

### E2E (Playwright) — §96's four journeys
1. **Marketplace as-is**: browse → filter → product → demo → buy → cart → checkout → (mocked provider) →
   webhook → My Software → download.
2. **Customization**: product → request customization → AI conversation (mocked model) → summary → submit →
   staff review → quote → accept → invoice → pay.
3. **Custom build**: landing → AI conversation → suggestions → submit → dashboard → staff message → response.
4. **Support/communication**: request → staff internal note + customer reply → verify the customer **never**
   sees the internal note.
Run against a seeded database with a mock payment provider and a mock AI provider. Include a mobile viewport
run for checkout.

### Accessibility & visual
`@axe-core/playwright` on marketplace, product, checkout and dashboard. Optional visual regression on the
product page and the quote PDF.

### CI (§97)
```
PR → install → lint → typecheck → unit → integration → build → e2e (smoke) → npm audit → review → merge
main → full e2e → deploy staging → smoke → manual approval → deploy production
```
- Parallelise; cache `node_modules` and the Next build cache.
- Required checks on `main`. Coverage reported, with a floor on `services/` and `lib/` rather than a global
  number that rewards testing trivia.
- Secrets from the CI vault; no real payment or AI keys in CI (mocks only).

### Environments (§97)
Local · Development · Staging/UAT · Production. Each with its own database, storage bucket, provider keys in
**test mode**, and an isolated AI key with a spend cap.
Document: migration strategy (Mongo is schemaless — write explicit, idempotent, reversible migration scripts for
shape changes and run them as a deploy step), rollback procedure, and the seed policy per environment.

## Acceptance criteria
- [ ] `npm test` runs unit + integration green from a clean checkout with no external services.
- [ ] All four §96 journeys pass in CI against mocked providers.
- [ ] The webhook suite covers success, failure, refund, duplicate delivery and tampered signature per provider.
- [ ] The tenant-isolation suite is a required check.
- [ ] A deliberately introduced regression (e.g. removing the entitlement check on download) fails CI.
- [ ] CI completes in under 10 minutes for a PR.
- [ ] No test depends on wall-clock time, real network, or execution order.
- [ ] Staging mirrors production configuration except for keys and data.
- [ ] A documented rollback has been rehearsed at least once.
