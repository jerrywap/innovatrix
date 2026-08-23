import "server-only";
import type { ClientSession } from "mongoose";
import { toObjectId } from "@/lib/db/base";
import { connectToDatabase, supportsTransactions } from "@/lib/db/client";
import { PRODUCT_TRANSITIONS, assertTransition, productTransitionRule } from "@/lib/db/states";
import { descriptionFields, type ProductDoc } from "@/lib/db/models/catalog";
import type { ProductCatalogue, ProductStatus } from "@/lib/db/enums";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { vendorFilter, type VendorScope } from "@/lib/auth/scope";
import type { Paginated } from "@/repositories/base";
import { isEmptyDocument, type RichTextDocument } from "@/lib/rich-text/schema";
import { slugify, uniqueSlug } from "@/lib/slug";
import { withTransaction } from "@/lib/db/transaction";
import { products } from "@/repositories/product.repository";
import { productFiles } from "@/repositories/product-file.repository";
import { productVersions } from "@/repositories/product-version.repository";
import { statusChange, writeAuditLog, type AuditActor } from "@/services/audit";
import { emit } from "@/lib/events";
import { assertTermsInCatalogue, deriveFacets } from "./facets";
import {
  DEFAULT_TESTING_CHECKLIST,
  computeReadiness,
  type Readiness,
  type ReadinessSnapshot,
} from "./readiness";

/**
 * Products — creation, section saves, and the §46 lifecycle.
 *
 * All the rules live here. Actions validate input and call in; components never
 * do. That is the architectural rule from `AGENTS.md`, and it is also what puts
 * every interesting decision inside vitest's coverage floor.
 */

/* ────────────────────────────────────────────── creation */

export interface CreateDraftInput {
  name: string;
  summary: string;
  description?: RichTextDocument;
  /**
   * The owning vendor — vendor ticket 04. Absent ⇒ first-party.
   *
   * Set at creation and never edited by the vendor: ownership is not a field on a
   * form. Staff reassigning a product is a different operation with its own audit
   * row, and it has to re-derive facets and re-denormalise the name.
   */
  vendor?: { id: string; slug: string; name: string };
  /**
   * Which catalogue it starts in. Defaults to `script` — the overwhelming
   * majority, and the same default the schema carries, so the two cannot
   * disagree.
   *
   * Changeable afterwards on the classification step, which is where its
   * categories are chosen too: moving a product between catalogues without
   * revisiting its vocabulary is how it ends up in `template` with script
   * categories.
   */
  catalogue?: ProductCatalogue;
  /**
   * Derive the slug from this instead of from `name`.
   *
   * Two listings of one application share a name — "Atlas CRM" the full script and
   * "Atlas CRM" the website template — and `uniqueSlug`'s collision fallback is a
   * **random** four-character suffix, deliberately ("`acme-2` tells the world that
   * `acme` exists… and a counter needs a read-then-write that races"). So the second
   * listing would get `atlas-crm-k7m2`: opaque, and non-deterministic, so it cannot
   * even be asserted in a test.
   *
   * A seed of `atlas-crm-template` is readable, predictable, and discloses nothing
   * the script's own public slug does not. The unique index is still the authority
   * and the random suffix still catches a genuine collision.
   */
  slugSeed?: string;
}

/**
 * Create a `draft` and return its id.
 *
 * The slug is derived from the name and made unique here, but the **unique
 * index is the authority**: two administrators creating "Atlas CRM" at the same
 * moment both pass `uniqueSlug`, and only one insert can win. The loser gets a
 * `ConflictError` naming the problem rather than a duplicate-key stack trace.
 */
export async function createDraft(
  input: CreateDraftInput,
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const slug = await uniqueSlug(input.slugSeed ?? input.name, (candidate) =>
    products.slugExists(candidate),
  );

  let created: ProductDoc;
  try {
    created = await products.create({
      name: input.name,
      summary: input.summary,
      slug,
      status: "draft",
      catalogue: input.catalogue ?? "script",
      ...descriptionFields(input.description),
      ...(input.vendor
        ? {
            vendorId: toObjectId(input.vendor.id),
            vendorSlug: input.vendor.slug,
            vendorName: input.vendor.name,
          }
        : {}),
      // Present-but-empty rather than absent: `facets` is derived on every
      // classification save, and a missing field would make the marketplace's
      // `$in` behave differently from an empty one.
      //
      // Except for the vendor term. This used to be a literal `[]`, which was
      // right when a draft had nothing to derive from — but a vendor's product is
      // owned from the moment it exists, and leaving the `vend:` term until the
      // first classification save would hide it from its own storefront in between.
      facets: await deriveFacets(input.vendor ? { vendorSlug: input.vendor.slug } : {}),
      // §47 — the checklist exists from the start so "not yet tested" is
      // visible rather than being indistinguishable from "no checklist".
      testingChecklist: DEFAULT_TESTING_CHECKLIST.map((item) => ({
        item,
        status: "pending" as const,
      })),
    } as Partial<ProductDoc>);
  } catch (error) {
    if (isDuplicateKey(error)) {
      throw new ConflictError(
        "A product with that name was just created. Try again — the slug will differ.",
      );
    }
    throw error;
  }

  await writeAuditLog({
    action: "product.created",
    actor,
    subject: { type: "product", id: String(created._id) },
    after: { name: created.name, slug: created.slug, status: "draft" },
  });

  return created;
}

/* ────────────────────────────────────────────── section saves */

/**
 * Write one wizard section.
 *
 * `$set` of named paths, never a whole-document replace — otherwise saving the
 * SEO step would blank the pricing entered two steps earlier. The section
 * schemas make that structural: each one describes only its own fields, so
 * there is nothing else to write.
 */
export async function saveSection(
  productId: string,
  section: string,
  update: Record<string, unknown>,
  actor: AuditActor,
  /**
   * Vendor ticket 04. Present ⇒ the write only lands if the product belongs to
   * this vendor; absent ⇒ a staff write across every product.
   *
   * The check is **in the filter**, not a read before the write. A caller who omits
   * the scope gets a staff-wide write, which is why omitting it has to be
   * deliberate — and `vendorFilter` throws on a blank string rather than widening,
   * so `scope: { vendorId: someValue ?? "" }` cannot silently become god mode.
   */
  scope: VendorScope = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  const saved =
    scope.vendorId === undefined
      ? await products.updateById(productId, setAndUnset(update))
      : await products.updateScoped(productId, scope, setAndUnset(update));

  // 404 for "not yours" as well as "not there". Distinguishing them tells a caller
  // which product ids are real, and a vendor product id is a URL somebody will try.
  if (!saved) throw new NotFoundError("product", { id: productId });

  await writeAuditLog({
    action: "product.section_updated",
    actor,
    subject: { type: "product", id: productId },
    // The changed keys, not the values: a pricing save would otherwise put
    // every price in the audit log, and a demo save would put ciphertext there.
    after: { section, fields: Object.keys(update) },
  });

  return saved;
}

/**
 * Split a section's fields into `$set` and `$unset`.
 *
 * MongoDB **drops `undefined` from `$set`** rather than clearing the field, so
 * the obvious `{ $set: update }` makes every optional field write-only: an
 * administrator who deletes the description, the turnaround estimate or an SEO
 * override saves successfully, sees the form come back empty, and the old value
 * is still on the live product page. Nothing errors, and the form agrees with
 * them — the stale value only shows up where a customer sees it.
 *
 * So `undefined` means "clear this", which is what clearing a field in the UI
 * produced in the first place. Fields the section did not mention are simply
 * absent from `update` and are untouched either way.
 */
function setAndUnset(update: Record<string, unknown>): {
  $set?: Record<string, unknown>;
  $unset?: Record<string, "">;
} {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};

  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) unset[key] = "";
    else set[key] = value;
  }

  return {
    ...(Object.keys(set).length > 0 ? { $set: set } : {}),
    ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
  };
}

/**
 * Save classification **and** re-derive `facets` in the same write.
 *
 * Its own function because this is the one section that can change what the
 * marketplace matches on. Doing it as a plain `saveSection` would leave the
 * facets describing the previous taxonomy — the product would keep appearing
 * under its old category and stop appearing under its new one.
 */
export async function saveClassification(
  productId: string,
  input: {
    catalogue: ProductCatalogue;
    categoryIds: string[];
    industryIds: string[];
    technologyIds: string[];
    productTypeId?: string;
  },
  actor: AuditActor,
  scope: VendorScope = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  /*
   * The vendor slug is read from the product rather than taken from the caller.
   *
   * This is the trap vendor ticket 04 names: facets are rewritten wholesale here,
   * so a `vend:` term that is not re-derived on this path is **silently wiped** the
   * next time anybody edits a product's categories. Nothing errors — the product
   * just stops appearing under its vendor, and the bug surfaces weeks later as
   * "why is my storefront empty".
   *
   * Reading it from the document rather than trusting an argument means the term
   * survives every caller, including one written later by somebody who has not read
   * this comment.
   */
  const owner = await products.findScoped(productId, scope);
  if (!owner) throw new NotFoundError("product", { id: productId });

  /*
   * A linked website template cannot be moved out of the template catalogue.
   *
   * `scriptListingId` only means anything on a `template`, so allowing the move
   * would leave a script carrying a pointer that says it is the front-end of
   * something. Inert — the banner gates on catalogue — but false, and false state
   * in the one write that exists to keep placement consistent is the thing this
   * function is for.
   *
   * A **refusal**, not a silent `$unset`: clearing the link because somebody
   * changed a dropdown is invisible data loss. `unlinkTemplateSibling` is the
   * button that makes this a step rather than a wall, and it is why that function
   * shipped in the same change.
   *
   * Free — `owner` is already read above for the vendor slug.
   */
  if (owner.scriptListingId && input.catalogue !== "template") {
    throw new ValidationError(
      "This listing is the front-end of a full script. Unlink it before moving it to another catalogue.",
      { catalogue: ["A linked website template must stay in the template catalogue."] },
    );
  }

  /*
   * A term from the other catalogue is refused, not dropped.
   *
   * `deriveFacets` drops ids it cannot *resolve* — a term somebody deleted — and
   * that is right, because there is nothing to say about it. This is a different
   * case: the term exists and the human just chose it, and silently discarding a
   * value somebody submitted is how a product ends up in a catalogue with no
   * categories and nobody knowing why.
   */
  await assertTermsInCatalogue(input, input.catalogue);

  const facets = await deriveFacets({
    ...input,
    ...(owner.vendorSlug ? { vendorSlug: owner.vendorSlug } : {}),
  });

  return saveSection(
    productId,
    "classification",
    {
      // The catalogue and the terms move in the **same** `$set`. Two writes could
      // leave a product in `template` carrying script categories, which is the one
      // state that makes browsing wrong in both directions at once.
      catalogue: input.catalogue,
      categoryIds: input.categoryIds.map((id) => toObjectId(id)),
      industryIds: input.industryIds.map((id) => toObjectId(id)),
      technologyIds: input.technologyIds.map((id) => toObjectId(id)),
      ...(input.productTypeId
        ? { productTypeId: toObjectId(input.productTypeId) }
        : { productTypeId: undefined }),
      facets,
    },
    actor,
    scope,
  );
}

/**
 * Change the public URL, retiring the old slug into history.
 *
 * Separate from the basics form because it is a different kind of event:
 * renaming a product does not move it, changing its slug does, and every link
 * anyone has shared depends on `slugHistory` catching the old one.
 */
export async function changeSlug(
  productId: string,
  desired: string,
  actor: AuditActor,
): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  const slug = slugify(desired);
  if (slug === product.slug) return product;

  if (await products.slugExists(slug, productId)) {
    // Includes slugs retired by *other* products — reusing one would hijack
    // their redirect.
    const suggestion = await uniqueSlug(slug, (candidate) =>
      products.slugExists(candidate, productId),
    );
    throw new ValidationError("That address is already taken.", {
      slug: [`"${slug}" is in use. Try "${suggestion}".`],
    });
  }

  const updated = await products.changeSlug(productId, product.slug, slug);
  if (!updated) throw new NotFoundError("product", { id: productId });

  await writeAuditLog({
    action: "product.slug_changed",
    actor,
    subject: { type: "product", id: productId },
    before: { slug: product.slug },
    after: { slug },
  });

  return updated;
}

/* ────────────────────────────────────────────── readiness */

/**
 * Everything blocking publish, for one product.
 *
 * Two reads: the product itself, and one aggregate over versions and files.
 * The rest is already embedded on the document, which is the payoff of the
 * embed-vs-reference split in `ERD.md`.
 */
/**
 * One vendor's products — vendor ticket 04.
 *
 * `vendorFilter` supplies the scope and throws on a blank one, so this cannot be
 * called in a way that lists everybody's products by accident. The vendor id comes
 * from `requireVendor()`, never from the request: a `vendorId` in a query string
 * is a claim, and `parseListParams`' `filterable` list deliberately does not
 * include it.
 *
 * Bounded and sorted on `{ vendorId, status, updatedAt }` (§94).
 */
export async function listForVendor(
  scope: VendorScope,
  options: {
    status?: ProductStatus;
    page?: number;
    limit?: number;
    sort?: Record<string, 1 | -1>;
  } = {},
): Promise<Paginated<ProductDoc>> {
  await connectToDatabase();

  return products.list({
    filter: {
      ...vendorFilter(scope),
      ...(options.status ? { status: options.status } : {}),
    },
    page: options.page ?? 1,
    limit: options.limit ?? 25,
    sort: options.sort ?? { updatedAt: -1 },
  });
}

export async function readinessFor(product: ProductDoc): Promise<Readiness> {
  const versions = await productVersions.listForProduct(String(product._id));
  const released = versions.filter((version) => version.status === "released");
  const withPackage = await productFiles.versionIdsWithPackage(
    released.map((version) => String(version._id)),
  );

  return computeReadiness(snapshotOf(product, released.length > 0, withPackage.size > 0));
}

function snapshotOf(
  product: ProductDoc,
  hasReleasedVersion: boolean,
  hasReleasedVersionWithPackage: boolean,
): ReadinessSnapshot {
  return {
    status: product.status,
    priceCount: product.prices.length,
    licencePackageCount: product.licencePackages.length,
    screenshotCount: product.media.filter((item) => item.kind === "screenshot").length,
    hasDescription: !isEmptyDocument(product.description),
    hasReleasedVersion,
    hasReleasedVersionWithPackage,
    checklist: product.testingChecklist.map((item) => ({
      status: item.status,
      ...(item.notes ? { notes: item.notes } : {}),
    })),
    currenciesWithoutLicencePrice: currenciesWithoutLicencePrice(product),
    catalogue: product.catalogue ?? "script",
    /*
     * `categoryIds.length` **is** the catalogue-permitted count, without a second
     * read.
     *
     * `saveClassification` refuses to store a term from the other catalogue, so a
     * template's categories are already template-or-both by construction. Counting
     * them here rather than re-resolving each term's scope keeps this snapshot one
     * document and keeps the admin list from doing a taxonomy read per row.
     *
     * The invariant is enforced on the write path. If that check is ever removed,
     * this count silently starts lying — which is why it is written down here.
     */
    catalogueCategoryCount: product.categoryIds.length,
  };
}

/**
 * Advertised currencies no licence package can actually be bought in.
 *
 * `product.prices` drives the listing; `licencePackages[].prices` drives the
 * cart line. Any currency in the first with no match in the second is a price a
 * customer can see and cannot pay.
 */
function currenciesWithoutLicencePrice(product: ProductDoc): string[] {
  if (product.licencePackages.length === 0) return [];

  const buyable = new Set(
    product.licencePackages.flatMap((pkg) => pkg.prices.map((price) => price.currency)),
  );

  return [...new Set(product.prices.map((price) => price.currency))].filter(
    (currency) => !buyable.has(currency),
  );
}

/**
 * Readiness for a whole page of products, in two queries rather than 2N.
 *
 * The admin list shows a "what's blocking publish" column per row. Computing it
 * per row is the N+1 that makes a list feel slow at exactly the point somebody
 * is scanning it.
 */
export async function readinessForMany(
  page: readonly ProductDoc[],
): Promise<Map<string, Readiness>> {
  if (page.length === 0) return new Map();

  const ids = page.map((product) => String(product._id));
  const releasedByProduct = await productVersions.productIdsWithReleasedVersion(ids);

  // Only products that have a released version can have a package on one.
  const releasedVersions = (
    await Promise.all(
      page
        .filter((product) => releasedByProduct.has(String(product._id)))
        .map(async (product) => ({
          productId: String(product._id),
          versions: (await productVersions.listForProduct(String(product._id))).filter(
            (version) => version.status === "released",
          ),
        })),
    )
  ).flatMap((entry) =>
    entry.versions.map((version) => ({
      productId: entry.productId,
      versionId: String(version._id),
    })),
  );

  const versionsWithPackage = await productFiles.versionIdsWithPackage(
    releasedVersions.map((entry) => entry.versionId),
  );

  const productsWithPackage = new Set(
    releasedVersions
      .filter((entry) => versionsWithPackage.has(entry.versionId))
      .map((entry) => entry.productId),
  );

  return new Map(
    page.map((product) => {
      const id = String(product._id);
      return [
        id,
        computeReadiness(
          snapshotOf(product, releasedByProduct.has(id), productsWithPackage.has(id)),
        ),
      ];
    }),
  );
}

/* ────────────────────────────────────────────── lifecycle */

/**
 * Move a product through §46's lifecycle.
 *
 * ## Order of checks
 *
 * `assertTransition` runs **first**, then readiness. Reversing them would tell
 * someone attempting `draft → published` to "add a screenshot" when their
 * actual problem is skipping review — and `StateTransitionError` already says
 * the useful thing for that case.
 *
 * ## Concurrency
 *
 * The write is a guarded `findOneAndUpdate({ _id, status: from })`. Two
 * administrators clicking publish at the same moment both pass every check
 * above; without the guard both would write, producing two audit entries for
 * one transition. The second gets `null` and a conflict it can act on.
 *
 * The audit row goes inside the transaction deliberately — a transition that
 * committed without its record is exactly what §90 exists to prevent, and an
 * insert made in the session cannot be duplicated by a replay.
 */
export async function transition(
  productId: string,
  to: ProductStatus,
  actor: AuditActor,
  options: {
    reason?: string;
    ip?: string;
    userAgent?: string;
    /** Vendor ticket 04 — a vendor may only move their own product. */
    scope?: VendorScope;
  } = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  const product = await products.findScoped(productId, options.scope ?? {});
  if (!product) throw new NotFoundError("product", { id: productId });

  const from = product.status;
  assertTransition("product", PRODUCT_TRANSITIONS, from, to);

  /*
   * Who may take this edge — vendor ticket 05.
   *
   * `assertTransition` says the move is legal for the *machine*; this says it is
   * legal for **this actor**. Read from `PRODUCT_TRANSITION_RULES` rather than
   * branched on here, so the screen that hides a control and the service that
   * refuses the POST are reading the same fact.
   *
   * Ordered after `assertTransition` deliberately, matching the publish path: a
   * vendor attempting `draft → published` should be told the transition is illegal,
   * not that they lack a permission for an edge that does not exist.
   */
  const rule = productTransitionRule(from, to);
  if (!rule) {
    // The drift test makes this unreachable. If it ever fires, the graph gained an
    // edge whose authorisation nobody decided — refuse rather than assume.
    throw new ForbiddenError(`No rule governs moving a product from ${from} to ${to}.`);
  }
  if (actor.type === "vendor" && !rule.vendorMay) {
    throw new ForbiddenError(`A vendor cannot move a product from ${from} to ${to}.`);
  }
  if (rule.requiresReason && !options.reason?.trim()) {
    throw new ValidationError("Say what needs changing — the vendor reads this.", {
      detail: ["A reason is required to send a submission back."],
    });
  }

  if (to === "published") await assertPublishable(product);
  if (to === "ready") await assertTestingComplete(product);
  // The submission gate, and it is the *same* gate as publication: one pure
  // `computeReadiness()` shared by both, so a vendor sees exactly the gaps a
  // reviewer would and "why can't I submit" needs no support thread.
  if (to === "submitted") await assertSubmittable(product);

  const extra: Record<string, unknown> = {};
  // Set once, on first publish. Re-publishing after deprecation must not
  // rewrite it — `publishedAt` is what "new this month" sorts on.
  if (to === "published" && !product.publishedAt) extra.publishedAt = new Date();

  const write = async (session?: ClientSession) => {
    const updated = await products.setStatusIfCurrent(productId, from, to, extra, session);
    if (!updated) {
      throw new ConflictError(
        "Someone else changed this product's status while you were working. " +
          "Reload and try again.",
      );
    }

    await writeAuditLog(
      {
        action: "product.status_changed",
        actor,
        subject: { type: "product", id: productId },
        ...statusChange(from, to, options.reason ? { reason: options.reason } : {}),
        ...(options.ip ? { ip: options.ip } : {}),
        ...(options.userAgent ? { userAgent: options.userAgent } : {}),
        // Who drove it, not which screen. A vendor's own transition recorded as
        // `admin` is wrong in the one collection that exists to be trusted later.
        source: actor.type === "vendor" ? "vendor" : "admin",
      },
      session,
    );

    return updated;
  };

  // Local development runs a standalone mongod, which cannot transact. The
  // guarded update still gives concurrency safety there; only the atomicity of
  // status-plus-audit is lost, and the audit write is retried best-effort.
  const updated = supportsTransactions() ? await withTransaction(write) : await write();

  /*
   * `ProductPublished` — emitted **after** the transaction commits, never inside it.
   *
   * The event bus dispatches synchronously and its handlers write notifications and
   * queue email; doing that inside the transaction would send mail for a status change
   * that then rolled back. `withTransaction` also warns its callback may run twice.
   *
   * The event has existed in `DOMAIN_EVENTS` since ticket 02 and was emitted nowhere,
   * so nothing could be told a product went live. Vendor ticket 05 is what needed it.
   */
  if (to === "published") {
    await emit("ProductPublished", {
      productId,
      productName: updated.name,
      productSlug: updated.slug,
      ...(updated.vendorId ? { vendorId: String(updated.vendorId) } : {}),
    });
  }

  return updated;
}

async function assertPublishable(product: ProductDoc): Promise<void> {
  const { gaps } = await readinessFor(product);
  if (gaps.length === 0) return;

  throw new ValidationError(
    `This product can't be published yet: ${gaps.map((gap) => gap.message.toLowerCase()).join("; ")}.`,
    // Keyed by gap code so the form can link each one to its step.
    Object.fromEntries(gaps.map((gap) => [gap.code, [gap.message]])),
  );
}

/**
 * The submission gate — vendor ticket 05.
 *
 * The **same** `computeReadiness()` the publish gate uses, unchanged. That is the
 * cheapest possible way to make "why can't I submit" answerable: a vendor sees the
 * identical checklist a reviewer sees, each gap links to the step that fixes it, and
 * the two cannot disagree because there is one function.
 *
 * `snapshot.status` is available to `computeReadiness` if submission ever needs a
 * different set of gaps from publication. It does not today, and inventing a second
 * set now would mean two things to keep in step for no demand.
 */
async function assertSubmittable(product: ProductDoc): Promise<void> {
  const { gaps } = await readinessFor(product);
  if (gaps.length === 0) return;

  throw new ValidationError(
    `This isn't ready to submit yet: ${gaps.map((gap) => gap.message.toLowerCase()).join("; ")}.`,
    Object.fromEntries(gaps.map((gap) => [gap.code, [gap.message]])),
  );
}

async function assertTestingComplete(product: ProductDoc): Promise<void> {
  const { isTestingComplete } = await readinessFor(product);
  if (isTestingComplete) return;

  throw new ValidationError(
    "Every item on the internal testing checklist has to pass — or be marked " +
      "not applicable with a note — before this is ready.",
    { testing_incomplete: ["The internal testing checklist is not finished."] },
  );
}

/**
 * Publish or unpublish several products at once.
 *
 * Per-product tolerant rather than all-or-nothing: a selection of twelve where
 * one is missing a screenshot should publish eleven and say why the twelfth
 * did not. A batch that fails whole makes the administrator find the culprit by
 * bisection.
 *
 * A product already in the target state is reported as **skipped**, not failed.
 * `assertTransition` throws when `from === to`, so without this a selection
 * containing an already-published product would report an error for a row where
 * nothing was wrong.
 */
export async function bulkTransition(
  productIds: readonly string[],
  to: ProductStatus,
  actor: AuditActor,
): Promise<{
  changed: string[];
  skipped: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; reason: string }>;
}> {
  const changed: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];
  const failed: Array<{ id: string; reason: string }> = [];

  for (const id of productIds) {
    try {
      const product = await products.findById(id);
      if (!product) {
        failed.push({ id, reason: "No longer exists." });
        continue;
      }
      if (product.status === to) {
        skipped.push({ id, reason: `Already ${to.replace(/_/g, " ")}.` });
        continue;
      }

      await transition(id, to, actor);
      changed.push(id);
    } catch (error) {
      failed.push({ id, reason: messageOf(error) });
    }
  }

  return { changed, skipped, failed };
}

/* ────────────────────────────────────────────── deletion */

/**
 * Soft-delete a product.
 *
 * Deliberately narrow. `archived` is the lifecycle terminal — the way a product
 * that existed stops being sold — and `deletedAt` is for **mistakes only**: a
 * draft created by accident, before anyone saw it. Anything with a version, an
 * order or an entitlement is archived instead, and `INTEGRITY.md` already makes
 * `entitlements.productId` a `restrict` so ownership outlives delisting.
 */
export async function softDelete(productId: string, actor: AuditActor): Promise<void> {
  await connectToDatabase();

  const product = await products.findById(productId);
  if (!product) throw new NotFoundError("product", { id: productId });

  if (product.status !== "draft") {
    throw new ValidationError(
      "Only a draft can be deleted. Archive this product instead — archiving keeps " +
        "it for anyone who already owns it.",
      { status: ["This product is not a draft."] },
    );
  }

  const versions = await productVersions.listForProduct(productId);
  if (versions.length > 0) {
    throw new ValidationError("This product has versions. Archive it instead of deleting it.", {
      versions: [`${versions.length} version(s) exist.`],
    });
  }

  /*
   * A website template listing points at this one — refuse, do not cascade.
   *
   * `restrict` rather than `cascade` because the two listings are separately
   * saleable things with separate artefacts, and deleting one because somebody
   * deleted the other is not a decision this function gets to make. `unlink` is a
   * button on the template's own review step, which is what makes this refusal
   * something the person can act on rather than a dead end.
   *
   * Note this only fires for a *draft* script with no versions — the two checks
   * above — which is exactly the state the checkbox can be used in, so the case is
   * reachable rather than theoretical.
   */
  const siblings = await products.countTemplateSiblingsOf(productId);
  if (siblings > 0) {
    throw new ValidationError(
      "A website template listing is linked to this product. Unlink it first, or delete it too.",
      { scriptListingId: ["A template listing points at this product."] },
    );
  }

  await products.deleteById(productId);

  await writeAuditLog({
    action: "product.deleted",
    actor,
    subject: { type: "product", id: productId },
    before: { slug: product.slug, status: product.status },
  });
}

/* ────────────────────────────────────────────── helpers */

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: unknown }).code === 11000
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}
