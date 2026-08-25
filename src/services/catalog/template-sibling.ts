import "server-only";
import { isDuplicateKeyError, toObjectId } from "@/lib/db/base";
import { connectToDatabase } from "@/lib/db/client";
import { descriptionFields, type ProductDoc, type ProductPrice } from "@/lib/db/models/catalog";
import { isEmptyDocument as isEmptyDoc } from "@/lib/rich-text/schema";
import { advertisedPrices } from "./advertised-price";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import type { VendorScope } from "@/lib/auth/scope";
import { products } from "@/repositories/product.repository";
import { writeAuditLog, type AuditActor } from "@/services/audit";
import { createDraft, saveSection } from "./product-service";
import { deriveFacets } from "./facets";

/**
 * Publishing one application as **two listings**.
 *
 * A vendor with a full script — front-end plus a working backend — often has a
 * second thing worth selling: the front-end on its own, as a website template, at
 * its own (usually lower, often free) price. This module creates that second
 * listing and links it back.
 *
 * ## Two documents, because the artefacts genuinely differ
 *
 * Not one product in two catalogues. `productId` is `required` and scalar on both
 * `ProductVersion` and `ProductFile`, the product id is baked into the S3 object
 * key, and `assertProductFileKey` exists specifically to stop one product's file
 * being attached to another. A front-end-only zip and a full-stack zip are two
 * artefacts; two artefacts are two products.
 *
 * The consequence, and the reason this creates a **draft** rather than a published
 * listing: the new listing independently needs its own upload, its own screenshot,
 * its own description, its own template categories and its own testing pass before
 * it can publish. `releaseVersion` refuses a version with no
 * `application_package`, so there is no version of this that auto-publishes
 * something buyable.
 *
 * ## Not the plugin feature
 *
 * A plugin is an `Addon`: bought alongside one listing, handed over out of band,
 * no artefact of its own. This is two listings of the same software at two price
 * points. Nothing here touches `addons` beyond copying them.
 *
 * ## The pair can be built from either end (COS-9)
 *
 * `createTemplateSibling` starts from the script; `createScriptSibling` starts from
 * the template, for a vendor who listed the front-end first and later built the
 * backend. Both produce the *same* pair — `scriptListingId` on the template,
 * pointing at the script — because that edge already runs in the direction both
 * need. What differs is only which document is inserted and which is updated, and
 * the two functions say so at their own write.
 */

/* ────────────────────────────────────────────── the copy map */

/**
 * Copied to the new listing.
 *
 * The test a field has to pass is **not** "can it be copied" — it is "is it still
 * true of the *other* half of the pair". Read script→template that means "still
 * true with no backend"; read template→script it means "still true once a backend
 * is added". The set is the same either way, because everything in `EXCLUDED` is
 * excluded for a reason that holds in both directions: it is either an artefact
 * (`media`, `currentVersionId`), a tally that belongs to one listing
 * (`orderCount`, `ratingSum`), or a claim about the software's own behaviour that
 * only its own uploader can make (`features`, `requirements`). The individual
 * reasons below are phrased for the script→template case, which is the one where
 * they are least obvious.
 */
const COPIED = {
  name: true,
  summary: true,
  /*
   * The description, and the flag that keeps it from counting as written.
   *
   * This was `EXCLUDED`, on reasoning that is still correct as far as it goes:
   * copying prose about a working application is a duplicate-content risk and a
   * set of behavioural claims that are false without a backend, and leaving it
   * empty is what made `no_description` force a human to write one.
   *
   * What that reasoning did not weigh is the vendor who now has to retype four
   * paragraphs, most of which is true of both listings. So the prose comes across
   * — and `descriptionInherited` comes with it, which keeps `no_description`
   * firing until the first Basics save clears the flag. A head start that still
   * cannot be published unread.
   */
  description: true,
  descriptionText: true,
  descriptionInherited: true,
  industryIds: true,
  prices: true,
  licencePackages: true,
  addons: true,
  installation: true,
  customization: true,
  deliveryMethod: true,
  vendorId: true,
  vendorSlug: true,
  vendorName: true,
} as const;

/** Written by `createDraft`, so copying them would fight it. */
const SEEDED_BY_CREATE_DRAFT = {
  _id: true,
  slug: true,
  status: true,
  catalogue: true,
  facets: true,
  deletedAt: true,
  scriptListingId: true,
} as const;

type Copied = keyof typeof COPIED;
type Seeded = keyof typeof SEEDED_BY_CREATE_DRAFT;
type Excluded = Exclude<keyof ProductDoc, Copied | Seeded>;

/**
 * Excluded, each with the reason it would be **false or broken** on the sibling.
 *
 * ## This is a `Record`, and that is the point
 *
 * `Excluded` is `Exclude<keyof ProductDoc, Copied | Seeded>`, so the day somebody
 * adds a field to `ProductDoc`, `tsc` fails **here**, naming it, until a human
 * decides which of the three buckets it belongs in. That is the `EVENT_NAME_SET`
 * technique from the registry fan-out table in `AGENTS.md` — the compiler catching
 * what a test would only catch if somebody remembered to extend it.
 *
 * So there is deliberately no filesystem-scanning test for this. The enforcement
 * set stays closed at fourteen.
 */
const EXCLUDED: Record<Excluded, string> = {
  features:
    "The sharpest case. 'Role-based access', 'Email notifications' render under " +
    '"What\'s included" and are actively false on a front-end. And there is **no** ' +
    "readiness gap for features, so a copied list reaches a customer having never been read.",
  requirements: "'PHP 8.2, MySQL 8' for a static front-end.",
  categoryIds:
    "Hard constraint: `assertTermsInCatalogue` refuses a script category in a template, " +
    "so the vendor's next classification save would fail about chips they never chose. " +
    "`no_template_category` exists to make them choose.",
  technologyIds:
    "All scoped `both`, so nothing would refuse them — but the seed's own fixtures are " +
    "the evidence: scripts carry Laravel/PostgreSQL, templates carry Tailwind/Bootstrap. " +
    "A template advertising 'PostgreSQL' is wrong in the `tech:` facet and the rail.",
  productTypeId:
    "Already on the record in the seed: a template is not a complete application, and " +
    "typing it as one puts it under the wrong facet in its own rail.",
  media:
    "Hard constraint: `assertProductMediaKey` binds a storage key to its product, so a " +
    "copied row would render (the URL is public) but could never be **replaced** — an " +
    "uneditable screenshot. `no_screenshot` forces real ones.",
  demo:
    "Hard constraint: the credential ciphertext is sealed against the product id, so a " +
    "copied `passwordCipher` is unrecoverable garbage. And the script's demo is a working " +
    "application, which is precisely what the template is not.",
  seo:
    "A copied title and description put two of our own pages in one auction with identical " +
    "text, and `ogImageUrl` points at a screenshot of the other listing. Empty falls back " +
    "to name + summary.",
  currentVersionId:
    "Points at a `ProductVersion` whose `productId` is the script. A copied pointer is the " +
    "cross-product artefact reference the whole storage model forbids.",
  publishedAt: "Nothing has been published. The sibling lands as a draft.",
  slugHistory:
    "Hard constraint: copying it would make this product answer for the other's retired " +
    "URLs, silently hijacking the redirect of the product that used to own them.",
  ratingSum:
    "A derived cache whose only writer is `recomputeProductRating`, in the review transaction.",
  ratingCount: "As `ratingSum`. Two listings mean two independent review pools, by decision.",
  ratingDistribution: "As `ratingSum`.",
  orderCount:
    "A count of orders placed for a different listing. Copying fabricates social proof and " +
    "corrupts the `{status, orderCount}` sort.",
  adaptedCount: "As `orderCount`.",
  isFeatured:
    "An editorial placement decision about one listing, driving `{status, isFeatured, publishedAt}`.",
  attestation:
    "A defence in a takedown, and it is about the version being submitted now. A copied " +
    "attestation is a fabricated legal declaration about an artefact nobody has uploaded.",
  reviewNotes:
    "An append-only review conversation about a different listing, carrying internal notes.",
  listingSuppressed:
    "Owned by the vendor-status sweep, which sets it across a vendor's products if it applies.",
  delistedReason: "As `listingSuppressed`.",
};

/*
 * The three maps above are read as **types** (`keyof typeof`), not as values, so
 * lint would call them unused. They are referenced here instead of being turned
 * into bare type unions, because a union cannot carry a reason per field — and the
 * reasons are the point of the exclusion map.
 */
void COPIED;
void SEEDED_BY_CREATE_DRAFT;
void EXCLUDED;

/** What the two `create*Sibling` functions write on top of the fresh draft. */
export interface SiblingCopy {
  industryIds: string[];
  description?: ProductDoc["description"];
  descriptionText?: string;
  descriptionInherited?: boolean;
  prices: ProductPrice[];
  licencePackages: ProductDoc["licencePackages"];
  addons: ProductDoc["addons"];
  installation: ProductDoc["installation"];
  customization: ProductDoc["customization"];
  deliveryMethod?: ProductDoc["deliveryMethod"];
}

/**
 * Build the copy, given the listing being copied *from* and the prices the
 * uploader entered.
 *
 * Pure — no database, no request context — so it is unit-testable and so the
 * decisions above are readable in one place rather than spread through a service
 * function.
 *
 * **Direction-neutral by construction.** The parameter is a `ProductDoc`, not "the
 * script": every field it reads is one a template carries too, so the same function
 * serves script→template and template→script. The one asymmetry is
 * `descriptionInherited`, which says "this prose came from the other listing" —
 * true either way, and `computeReadiness` words the resulting gap from the
 * *recipient's* catalogue rather than from here.
 *
 * The prices are written to `prices` **and** to every copied licence package, which
 * is what makes `unbuyable_currency` structurally impossible on the new listing:
 * that gap fires when the marketplace advertises a currency the cart cannot build a
 * line in, and here the two lists come from one input. If anyone ever splits those
 * two writes, that gap starts firing on every sibling.
 */
export function buildSiblingCopy(
  source: ProductDoc,
  prices: readonly ProductPrice[],
): SiblingCopy {
  // Shells only: the commercial terms transfer (they are platform defaults), the
  // money does not. A script with three tiers gives three packages all at this
  // one price, and the panel says so before the click.
  const licencePackages = source.licencePackages.map((pkg) => ({
    ...pkg,
    prices: [...prices],
  }));

  return {
    industryIds: source.industryIds.map(String),
    /*
     * The prose, marked as unread.
     *
     * `descriptionFields()` writes `description` and `descriptionText` as a pair or
     * neither, so the pair is spread rather than assigned field by field — and the
     * flag only goes on when there is actually something to review. A listing with
     * no description gives a sibling with none, and `no_description` fires for the
     * ordinary reason.
     */
    ...descriptionFields(source.description),
    ...(isEmptyDoc(source.description) ? {} : { descriptionInherited: true }),
    // Derived from the packages just built rather than assigned the same literal.
    // Identical today — every package gets the one entered price — and it stays
    // identical the day the panel learns to price tiers separately.
    prices: advertisedPrices(licencePackages),
    licencePackages,
    addons: source.addons,
    installation: source.installation,
    customization: {
      ...source.customization,
      // Money quoted for adapting the *whole application*. Never copy money.
      startingPrice: undefined,
    },
    ...(source.deliveryMethod ? { deliveryMethod: source.deliveryMethod } : {}),
  };
}

/* ────────────────────────────────────────────── the service */

/**
 * Create the website template listing for a full script, and link it back.
 *
 * ## The link is written on the template, so this is one insert plus one update
 *
 * Not a transaction. `supportsTransactions()` is false on a standalone mongod, so
 * one would not protect the developer who has to debug this — the same trade
 * `transition` already accepts in writing. If the second write fails, what is left
 * is a bare draft in `template` with no link: invisible to customers, no banner,
 * and deletable, because `softDelete` permits a draft with no versions.
 */
export async function createTemplateSibling(
  scriptProductId: string,
  input: { prices: readonly ProductPrice[] },
  actor: AuditActor,
  scope: VendorScope = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  // Scoped: a vendor asking about somebody else's product gets a 404, not a 403 —
  // whether it exists is not their business either. The position taken everywhere.
  const script = await products.findScoped(scriptProductId, scope);
  if (!script) throw new NotFoundError("product", { id: scriptProductId });

  if ((script.catalogue ?? "script") !== "script") {
    throw new ValidationError("Only a full script can also be listed as a website template.", {
      catalogue: ["This listing is not in the script catalogue."],
    });
  }

  if (script.scriptListingId) {
    // A linked template asking to spawn one of its own. Refused here rather than
    // relying on the catalogue check above, because it is a different mistake with
    // a different fix.
    throw new ValidationError("This listing is already the front-end of another product.", {
      scriptListingId: ["It cannot also have a front-end of its own."],
    });
  }

  if (input.prices.length === 0) {
    throw new ValidationError("Give the template listing a price in at least one currency.", {
      prices: ["No currency was priced."],
    });
  }

  // A courtesy, for the message. The partial unique index is the authority, and the
  // duplicate-key catch below reports the same sentence.
  const existing = await products.findTemplateSiblingOf(scriptProductId);
  if (existing) {
    throw new ConflictError("This product already has a website template listing.");
  }

  const draft = await createDraft(
    {
      name: script.name,
      summary: script.summary,
      catalogue: "template",
      // Deterministic, so the public URL is `atlas-crm-template` rather than
      // `uniqueSlug`'s random four-character fallback.
      slugSeed: `${script.slug}-template`,
      ...(script.vendorId
        ? {
            vendor: {
              id: String(script.vendorId),
              slug: script.vendorSlug ?? "",
              name: script.vendorName ?? "",
            },
          }
        : {}),
    },
    actor,
  );

  const copy = buildSiblingCopy(script, input.prices);
  const templateId = String(draft._id);

  try {
    await saveSection(
      templateId,
      "template_link",
      {
        ...copy,
        industryIds: copy.industryIds.map((id) => toObjectId(id)),
        scriptListingId: script._id,
        // The ids and the facets in the **same** `$set`, mirroring
        // `saveClassification`'s invariant: two writes could leave them disagreeing,
        // and then the listing is missing from its own industry filter.
        facets: await deriveFacets({
          industryIds: copy.industryIds,
          ...(script.vendorSlug ? { vendorSlug: script.vendorSlug } : {}),
        }),
      },
      actor,
      scope,
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      // The index won a race the courtesy check above lost.
      throw new ConflictError("This product already has a website template listing.");
    }
    throw error;
  }

  await writeAuditLog({
    action: "product.template_sibling_created",
    actor,
    subject: { type: "product", id: templateId },
    // Both ids, because the row's job is the *relation*. Currencies but not
    // amounts — `saveSection` already records which keys changed, and an audit log
    // is not a price history.
    after: {
      scriptProductId,
      templateProductId: templateId,
      currencies: input.prices.map((price) => price.currency),
    },
    source: "catalog",
  });

  const linked = await products.findById(templateId);
  return linked ?? draft;
}

/**
 * Create the **backend script** for a website template, and link the template to
 * it — COS-9, the pair built from the other end.
 *
 * A vendor who listed a front-end first and has since built the backend gets the
 * same pair `createTemplateSibling` produces: `scriptListingId` on the template,
 * pointing at the script. The edge already runs in that direction, so this needs no
 * schema change and no second field — a "backend script" is simply
 * `catalogue: "script"`.
 *
 * ## The insert and the update swap places, and that costs something
 *
 * Its twin writes the edge on the row it just inserted, so a failure leaves an
 * unlinked draft and nothing else. Here the edge lands on the *pre-existing*
 * template, which is a row other requests can be holding. Hence
 * `products.linkScriptListing`, whose filter carries the "not already linked"
 * condition: a second caller matches nothing and is refused, rather than
 * repointing the template and stranding the first script.
 *
 * Still not a transaction — `supportsTransactions()` is false on a standalone
 * mongod, the trade this module already accepts in writing above. If the link write
 * fails, what is left is a bare draft in `script` with no link: invisible to
 * customers, no banner, and deletable, because `softDelete` permits a draft with no
 * versions.
 */
export async function createScriptSibling(
  templateProductId: string,
  input: { prices: readonly ProductPrice[] },
  actor: AuditActor,
  scope: VendorScope = {},
): Promise<ProductDoc> {
  await connectToDatabase();

  const template = await products.findScoped(templateProductId, scope);
  if (!template) throw new NotFoundError("product", { id: templateProductId });

  if ((template.catalogue ?? "script") !== "template") {
    throw new ValidationError("Only a website template can also be listed as a full script.", {
      catalogue: ["This listing is not in the website template catalogue."],
    });
  }

  if (template.scriptListingId) {
    throw new ConflictError("This template already has a backend script listing.");
  }

  if (input.prices.length === 0) {
    throw new ValidationError("Give the script listing a price in at least one currency.", {
      prices: ["No currency was priced."],
    });
  }

  const draft = await createDraft(
    {
      name: template.name,
      summary: template.summary,
      catalogue: "script",
      // Deterministic, for the same reason as the forward direction. A template
      // created *by* `createTemplateSibling` is already `…-template`, and this
      // path refuses those anyway (it checks `scriptListingId` above), so there is
      // no `…-template-script` to trim.
      slugSeed: `${template.slug}-script`,
      ...(template.vendorId
        ? {
            vendor: {
              id: String(template.vendorId),
              slug: template.vendorSlug ?? "",
              name: template.vendorName ?? "",
            },
          }
        : {}),
    },
    actor,
  );

  const copy = buildSiblingCopy(template, input.prices);
  const scriptId = String(draft._id);

  await saveSection(
    scriptId,
    "template_link",
    {
      ...copy,
      industryIds: copy.industryIds.map((id) => toObjectId(id)),
      // The ids and the facets in the **same** `$set`, mirroring
      // `saveClassification`'s invariant.
      facets: await deriveFacets({
        industryIds: copy.industryIds,
        ...(template.vendorSlug ? { vendorSlug: template.vendorSlug } : {}),
      }),
    },
    actor,
    scope,
  );

  // The edge, on the template, conditionally. `null` means somebody linked it
  // between the check above and here.
  let linked;
  try {
    linked = await products.linkScriptListing(templateProductId, scriptId);
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ConflictError("This template already has a backend script listing.");
    }
    throw error;
  }
  if (!linked) {
    throw new ConflictError("This template already has a backend script listing.");
  }

  await writeAuditLog({
    action: "product.script_sibling_created",
    actor,
    subject: { type: "product", id: scriptId },
    after: {
      templateProductId,
      scriptProductId: scriptId,
      currencies: input.prices.map((price) => price.currency),
    },
    source: "catalog",
  });

  const created = await products.findById(scriptId);
  return created ?? draft;
}

/**
 * Break the link, leaving both listings in place.
 *
 * Small, and it earns its place twice: it is the escape hatch for a pointer whose
 * target went away, and it is what makes `saveClassification`'s refusal to move a
 * linked template out of the template catalogue something a person can act on
 * rather than a dead end.
 */
export async function unlinkTemplateSibling(
  templateProductId: string,
  actor: AuditActor,
  scope: VendorScope = {},
): Promise<void> {
  await connectToDatabase();

  const template = await products.findScoped(templateProductId, scope);
  if (!template) throw new NotFoundError("product", { id: templateProductId });

  if (!template.scriptListingId) {
    throw new ValidationError("This listing is not linked to a full script.", {
      scriptListingId: ["There is nothing to unlink."],
    });
  }

  // `undefined` rather than a literal: `setAndUnset` turns it into `$unset`, which
  // is what the partial index's `$type: "objectId"` condition needs to stop
  // matching. A `null` would keep the field present and keep the slot taken.
  await saveSection(
    templateProductId,
    "template_link",
    { scriptListingId: undefined },
    actor,
    scope,
  );
}
