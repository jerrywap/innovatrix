/**
 * The brand, in one place.
 *
 * `rebrand.md` §31 Phase 2 asks for central brand values rather than the same
 * literal in forty files, and the audit that preceded the rebrand found exactly
 * the failure that argues for it: the `(auth)` layout had its own hand-rolled
 * copy of the wordmark, so the two drifted the moment one changed.
 *
 * ## Two names, and the line between them
 *
 * `name` is the brand and belongs in prose, UI, email and metadata.
 * `legalName` is the incorporated entity and belongs **only** where a legal
 * entity is required: the copyright line, the terms pages, the self-billed
 * payout statement, and the account name on a bank transfer. Using the entity
 * anywhere else reads as a different company; using the brand on a bank
 * transfer sends money to an account that does not exist.
 *
 * ## Not `server-only`
 *
 * Client components render the wordmark, so this file crosses the boundary.
 * That is safe because everything here is public by definition — a value that
 * needed protecting would belong in `env.ts` and never in a file named after
 * the thing printed at the top of every page.
 *
 * Prose keeps the literal `CoSetup` rather than interpolating `BRAND.name`:
 * the brand name is not a runtime variable, and a sentence broken by a template
 * expression is harder to read and to grep for than the sentence itself.
 * `BRAND.*` is for metadata, configuration and generated documents.
 */
export const BRAND = {
  name: "CoSetup",
  /** The incorporated entity. CoSetup is its trading name. */
  legalName: "Perfect Gateway LTD",
  domain: "cosetup.net",
  url: "https://cosetup.net",
  /** §7 — used selectively, and never welded to the logo. */
  tagline: "Software, set up for you.",
} as const;

/** The one-line identity statement for legal surfaces. */
export const BRAND_LEGAL_IDENTITY = `${BRAND.name} is a trading name of ${BRAND.legalName}.`;
