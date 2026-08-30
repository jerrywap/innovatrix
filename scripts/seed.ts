/**
 * Development seed — ticket 02.
 *
 * Idempotent by design: every write is an upsert keyed on a natural identifier
 * (slug, email, reference), so running it twice changes nothing and running it
 * against a partly-populated database repairs rather than duplicates.
 *
 *   npm run db:seed
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import mongoose from "mongoose";
import { toObjectId } from "../src/lib/db/base";
import { seal } from "../src/lib/crypto";
import { checkCharacter } from "../src/lib/licence-key";
import { fromDecimal } from "../src/lib/money";
import { formatReference } from "../src/lib/references";
import { syncAllIndexes } from "./sync-indexes";
import { BRAND } from "../src/config/brand";

import { slugify } from "../src/lib/slug";
import { TAXONOMY_VOCABULARY } from "./taxonomy-vocabulary";

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — copy .env.example to .env.local");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });
  console.log("connected:", mongoose.connection.name);

  // Imported after connect so model registration happens on a live connection.
  const M = await import("../src/lib/db/models");

  /* ── taxonomies ─────────────────────────────────────────── */
  // One vocabulary, shared with `seed-bulk.ts`. The two used to disagree about
  // `product_type` and each auto-created what the other was missing.
  const taxonomies = TAXONOMY_VOCABULARY;

  const taxonomyIds = new Map<string, mongoose.Types.ObjectId>();
  // Names, so the second pass can resolve `parent` (a name) to an id.
  const idByCategoryName = new Map<string, mongoose.Types.ObjectId>();
  for (const t of taxonomies) {
    // `t.slug` wins where it is stated: `slugify("Business & Operations")` is
    // `business-and-operations`, which is a worse URL than the one we chose.
    const slug = t.slug ?? slugify(t.name);
    const doc = await M.Taxonomy.findOneAndUpdate(
      { kind: t.kind, slug },
      {
        $set: {
          name: t.name,
          sortOrder: t.sortOrder,
          isActive: true,
          // Stated, not defaulted: the eight script categories being explicitly
          // `script` is what keeps them out of the template rail.
          catalogue: t.catalogue,
          ...(t.description ? { description: t.description } : {}),
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();
    taxonomyIds.set(`${t.kind}:${slug}`, doc!._id);
    if (t.kind === "category") idByCategoryName.set(t.name, doc!._id);
  }

  /*
   * Second pass for `parentId`, and it has to be a second pass.
   *
   * A child can be upserted before its parent exists — the vocabulary lists
   * parents first, but nothing in the loop above guarantees the parent's id is
   * known at the moment the child is written. Resolving the whole tier first and
   * linking afterwards makes the order irrelevant.
   */
  let parented = 0;
  for (const t of taxonomies) {
    if (t.kind !== "category" || !t.parent) continue;
    const parentId = idByCategoryName.get(t.parent);
    if (!parentId) throw new Error(`missing parent category "${t.parent}" for "${t.name}"`);
    const slug = t.slug ?? slugify(t.name);
    const result = await M.Taxonomy.updateOne(
      { kind: "category", slug, parentId: { $ne: parentId } },
      { $set: { parentId } },
    );
    parented += result.modifiedCount;
  }
  console.log(`taxonomies: ${taxonomyIds.size} (${parented} newly parented)`);

  const tax = (kind: string, name: string) => {
    const id = taxonomyIds.get(`${kind}:${slugify(name)}`);
    if (!id) throw new Error(`missing taxonomy ${kind}:${name}`);
    return id;
  };

  /**
   * The same amount in all three storefront currencies.
   *
   * Indicative rates, fixed — the platform holds a real price per currency and
   * never converts (§84), so these are three independent prices that happen to
   * be derived from one number for the seed's convenience.
   */
  const everyCurrency = (gbp: number) => [
    { currency: "GBP", amount: fromDecimal(gbp, "GBP").amount },
    { currency: "USD", amount: fromDecimal(Math.round(gbp * 1.27), "USD").amount },
    { currency: "NGN", amount: fromDecimal(gbp * 2000, "NGN").amount },
  ];

  /**
   * A password for every seeded person.
   *
   * Without this the seed produces users nobody can sign in as — an order, an
   * entitlement, a licence and a dashboard, all unreachable, because Better
   * Auth authenticates against an `accounts` row and the seed only ever wrote
   * `users`. That was true from ticket 02 until ticket 15 needed to open the
   * customer dashboard and could not.
   *
   * Hashed with Better Auth's own `hashPassword` (scrypt) rather than a
   * hand-rolled equivalent, so the seed cannot drift from whatever the library
   * verifies with. The row shape matches `sign-up.mjs` exactly: `providerId:
   * "credential"` and `accountId` set to the user's id.
   *
   * Development only, and it looks it. `DEMO_PASSWORD` is deliberately not
   * read from the environment — a seed that can be pointed at production with
   * a real-looking password is a seed that eventually is.
   */
  const DEMO_PASSWORD = "innovatrix-demo-2026";

  async function setDemoPassword(userId: mongoose.Types.ObjectId): Promise<void> {
    const id = String(userId);
    const existing = await M.Account.findOne({ userId, providerId: "credential" })
      .select("+password")
      .lean();

    // Re-hashing on every run would be wasted scrypt work — and, worse, it
    // would silently reset a password somebody changed while testing.
    if (existing?.password) return;

    await M.Account.findOneAndUpdate(
      { providerId: "credential", accountId: id },
      { $set: { userId, password: await hashPassword(DEMO_PASSWORD) } },
      { upsert: true },
    );
  }

  /**
   * A release file that can actually be downloaded.
   *
   * Ticket 14 ends at `GET /api/downloads/[fileId]`, which redirects to a
   * presigned S3 URL. Without an object behind the key, every one of those
   * redirects lands on a 404 from the bucket — the authorisation is right, the
   * signature is right, and the customer still gets nothing. A `productFiles`
   * row with no bytes is worse than no row: it renders a Download button that
   * cannot work.
   *
   * ## Idempotent, which is the only awkward part
   *
   * `productFileKey()` mints a `nanoid()` per call, so regenerating the key
   * every run would orphan the previous object on each seed. The existing row's
   * `storageKey` is reused when there is one, and a new key minted only on first
   * creation.
   *
   * ## Skipped, loudly, when storage is not configured
   *
   * A seed that requires S3 credentials is a seed that cannot be run by someone
   * setting the project up for the first time. Everything else still seeds.
   */
  let storageSkipReason: string | null = null;
  let filesUploaded = 0;

  async function seedDownloadableFile(
    productId: string,
    versionId: string,
    slug: string,
  ): Promise<void> {
    if (storageSkipReason) return;

    // `storageContext`, `s3Client` and `bucket` live in `storage/client`, which
    // the barrel does not re-export — it exposes operations, not plumbing.
    const storage = await import("../src/services/storage");
    const { bucket, s3Client, storageContext } = await import("../src/services/storage/client");
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");

    // Only a *configuration* gap is a skip. Anything else is a bug in this
    // function, and swallowing it as "storage not configured" is how a broken
    // seed reports success — which is exactly what happened on the first run of
    // this code.
    if (!process.env.STORAGE_BUCKET || !process.env.STORAGE_ACCESS_KEY_ID) {
      storageSkipReason = "STORAGE_BUCKET / STORAGE_ACCESS_KEY_ID are not set";
      return;
    }

    const ctx = storageContext();

    const filename = `${slug}-1.0.0.zip`;

    // Deterministic bytes, so the checksum is stable across runs and machines.
    // Not a real archive — enough of one that a browser saves it and a checksum
    // means something.
    const body = Buffer.from(
      `CoSetup development placeholder for ${slug} v1.0.0.\n` +
        "Not a real release artefact — seeded so the download path is exercisable.\n",
      "utf8",
    );
    const checksum = createHash("sha256").update(body).digest("base64");

    const existing = await M.ProductFile.findOne({
      versionId: toObjectId(versionId),
      filename,
    }).lean();

    const key =
      existing?.storageKey ?? storage.productFileKey(ctx, productId, versionId, filename);

    await s3Client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        // The shared-bucket guard, applied on the way in as well as on the way
        // out: `sharepro-ng` also holds live application data, and nothing here
        // may write outside `innovatrix/{env}/`.
        Key: storage.assertKeyInPrefix(key, ctx.root),
        Body: body,
        ContentType: "application/zip",
      }),
    );

    await M.ProductFile.findOneAndUpdate(
      { versionId: toObjectId(versionId), filename },
      {
        $set: {
          productId: toObjectId(productId),
          kind: "application_package",
          storageKey: key,
          sizeBytes: body.byteLength,
          contentType: "application/zip",
          checksumSha256: checksum,
        },
      },
      // `findOneAndUpdate` skips validators by default, which is how the first
      // version of this wrote `kind: "release"` — not a value in
      // `PRODUCT_FILE_KINDS` — and reported success. The enum caught it only
      // once an integration test used `create()`.
      { upsert: true, runValidators: true },
    );

    filesUploaded += 1;
  }

  /*
   * ── staff: one login per §77 role ─────────────────────────
   *
   * All eleven, not the five the MVP screens were built against.
   *
   * The gap was found by curling `/admin/audit` as each seeded account: the
   * permissions it needs (`audit.view`, `system.manage_jobs`) belong to
   * `devops`, and there was no `devops` login — so those two screens could only
   * be reached as `super_admin`, which is the one role that proves nothing
   * about whether the permission checks work. The same was true of every
   * queue and control gated on `sales`, `developer`, `project_manager`,
   * `support_agent` or `content_manager`.
   *
   * An unreachable role is an untestable permission, and an untestable
   * permission is one nobody notices is wrong.
   */
  const staff = [
    ["super@innovatrix.test", "Sam Okafor", "super_admin"],
    ["service@innovatrix.test", "Priya Raman", "customer_service"],
    ["analyst@innovatrix.test", "Tom Byrne", "technical_analyst"],
    ["market@innovatrix.test", "Lena Novak", "marketplace_manager"],
    ["finance@innovatrix.test", "Ade Bello", "finance"],
    ["sales@innovatrix.test", "Ruth Adeyemi", "sales"],
    ["dev@innovatrix.test", "Marek Kowal", "developer"],
    ["pm@innovatrix.test", "Grace Mensah", "project_manager"],
    ["support@innovatrix.test", "Dan Whitfield", "support_agent"],
    ["devops@innovatrix.test", "Ines Duarte", "devops"],
    ["content@innovatrix.test", "Joy Nakamura", "content_manager"],
  ] as const;

  for (const [email, name, role] of staff) {
    const user = await M.User.findOneAndUpdate(
      { email },
      { $set: { name, isStaff: true, emailVerified: true } },
      { upsert: true, returnDocument: "after" },
    ).lean();
    await M.StaffProfile.findOneAndUpdate(
      { userId: user!._id },
      { $set: { roles: [role], isActive: true } },
      { upsert: true, returnDocument: "after" },
    );
    await setDemoPassword(user!._id);
  }
  console.log(`staff: ${staff.length}`);

  /* ── a customer organization ─────────────────────────────── */
  const customer = await M.User.findOneAndUpdate(
    { email: "amara@brightpath.test" },
    { $set: { name: "Amara Okonjo", emailVerified: true } },
    { upsert: true, returnDocument: "after" },
  ).lean();
  await setDemoPassword(customer!._id);

  const org = await M.Organization.findOneAndUpdate(
    { slug: "brightpath-care" },
    {
      $set: {
        name: "Brightpath Care",
        billingEmail: "amara@brightpath.test",
        defaultCurrency: "GBP",
        billingAddress: {
          line1: "12 Kingsway",
          city: "Leeds",
          postcode: "LS1 2ES",
          country: "GB",
        },
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();

  await M.OrganizationMember.findOneAndUpdate(
    { organizationId: org!._id, userId: customer!._id },
    { $set: { role: "owner", status: "active", acceptedAt: new Date() } },
    { upsert: true, returnDocument: "after" },
  );

  /*
   * The other four organisation roles, in the same organisation.
   *
   * Same reasoning as the staff roles above: `requireOrgRoleOrForbid(["owner",
   * "admin", "billing"])` guards the invoice screens, and with only an `owner`
   * seeded there was no way to see it refuse anybody — a guard that has only
   * ever been observed allowing is a guard nobody has tested.
   *
   * `member` is the interesting one to have: it is the role that should reach
   * almost nothing, so it is the one that shows a mis-scoped screen.
   */
  const colleagues = [
    ["kwame@brightpath.test", "Kwame Boateng", "admin"],
    ["bilal@brightpath.test", "Bilal Haddad", "billing"],
    ["tobi@brightpath.test", "Tobi Alabi", "technical"],
    ["nina@brightpath.test", "Nina Petrova", "member"],
  ] as const;

  for (const [email, name, role] of colleagues) {
    const user = await M.User.findOneAndUpdate(
      { email },
      { $set: { name, emailVerified: true } },
      { upsert: true, returnDocument: "after" },
    ).lean();
    await setDemoPassword(user!._id);
    await M.OrganizationMember.findOneAndUpdate(
      { organizationId: org!._id, userId: user!._id },
      { $set: { role, status: "active", acceptedAt: new Date() } },
      { upsert: true, returnDocument: "after" },
    );
  }
  console.log(`organisation members: ${colleagues.length + 1}`);

  /* ── products ────────────────────────────────────────────── */
  const products = [
    {
      slug: "atlas-crm",
      name: "Atlas CRM",
      summary: "A complete sales and customer system for teams that outgrew spreadsheets.",
      category: "CRM",
      industry: "Property",
      tech: ["Laravel", "PostgreSQL"],
      price: 299,
      adapted: 23,
      // `public` — anyone gets the URL *and* the credentials. The "Try the
      // demo" CTA links straight out.
      demo: {
        exposure: "public" as const,
        publicUrl: "https://demo.innovatrix.test/atlas",
        adminUrl: "https://demo.innovatrix.test/atlas/admin",
        instructions: "Sign in as the administrator to see reporting and user management.",
        resetSchedule: "Nightly at 02:00 UTC",
        credentials: [
          {
            role: "Administrator",
            label: "Full access",
            username: "admin@atlas.demo",
            password: "demo-admin-2026",
          },
          {
            role: "Sales",
            label: "Read and write deals",
            username: "sales@atlas.demo",
            password: "demo-sales-2026",
          },
        ],
      },
      areas: [
        "Branding",
        "User roles",
        "Reports",
        "Payment methods",
        "Workflows",
        "Integrations",
      ],
    },
    {
      slug: "tenancy",
      name: "Tenancy",
      summary: "Listings, landlords, tenants and rent reminders in one place.",
      category: "Property",
      industry: "Property",
      tech: ["Next.js", "MongoDB"],
      price: 450,
      adapted: 11,
      // `authenticated` — no public URL, so the CTA anchors to the demo panel,
      // which shows the locked notice to a signed-out visitor.
      demo: {
        exposure: "authenticated" as const,
        customerUrl: "https://demo.innovatrix.test/tenancy",
        instructions: "The tenant portal and the landlord view use different logins.",
        resetSchedule: "Weekly, Sunday 03:00 UTC",
        credentials: [
          {
            role: "Landlord",
            username: "landlord@tenancy.demo",
            password: "demo-landlord-2026",
          },
          { role: "Tenant", username: "tenant@tenancy.demo", password: "demo-tenant-2026" },
        ],
      },
      areas: ["Branding", "Tenant portal", "Rent schedules", "Reports"],
    },
    {
      slug: "roster",
      name: "Roster",
      summary: "Shift scheduling and timesheets built for care agencies.",
      category: "HR & Rota",
      industry: "Healthcare",
      tech: ["Next.js", "MongoDB"],
      price: 380,
      adapted: 17,
      // `owners_only` — the strictest. This is ticket 09's payload-leak target:
      // an anonymous request for this page must contain no credential field at
      // all, not even the key names.
      demo: {
        exposure: "owners_only" as const,
        publicUrl: "https://demo.innovatrix.test/roster",
        customerUrl: "https://demo.innovatrix.test/roster/app",
        adminUrl: "https://demo.innovatrix.test/roster/admin",
        instructions: "The rota view and the manager view are separate logins.",
        resetSchedule: "Nightly at 01:00 UTC",
        credentials: [
          { role: "Manager", username: "manager@roster.demo", password: "demo-manager-2026" },
        ],
      },
      areas: ["Branding", "Payroll export", "Mobile access", "Compliance records"],
    },
    {
      slug: "freightline",
      name: "Freightline",
      summary: "Driver tracking, depot handovers and customer notifications.",
      category: "Logistics",
      industry: "Logistics",
      tech: ["Laravel", "MySQL"],
      price: 520,
      adapted: 6,
      // Deliberately no demo. The "nothing configured" path needs a real
      // example, or nobody notices when it starts rendering an empty section.
      areas: ["Branding", "Route planning", "Customer notifications"],
    },
    {
      /*
       * The free-tier fixture, and it carries three of the four combinations on
       * its own: a **free** script, a **paid** plugin and a **free** plugin. The
       * four paid products above are the fourth.
       *
       * `price: 0` is a real price, not an absent one — it flows into both
       * `prices` and `licencePackages[].prices` below, which it has to, or
       * `readiness.ts` refuses to publish it as `unbuyable_currency`: a listing
       * showing a price the cart cannot build a line from.
       *
       * It exists so `?free=true`, the FREE badge, the £0 checkout path and the
       * plugin handover queue all have something behind them on a fresh database.
       */
      slug: "storefront-starter",
      name: "Storefront Starter",
      summary:
        "A working ecommerce storefront you can run as it is — or add a payment gateway to.",
      category: "E-commerce",
      industry: "Retail",
      tech: ["Next.js", "PostgreSQL"],
      price: 0,
      adapted: 4,
      areas: ["Branding", "Payment gateway", "Shipping rules"],
      addons: [
        {
          // The headline case: the script is free, this is not. Bought at
          // checkout, then handed over out of band — a Stripe account key is not
          // something this platform can deliver.
          key: "stripe-gateway",
          name: "Stripe gateway",
          pricingType: "fixed" as const,
          price: 49,
        },
        {
          // A free plugin, so "free + free" is on the screen too. Zero here means
          // zero, which is exactly what `addItem` no longer confuses with "no
          // price in this currency".
          key: "csv-export",
          name: "CSV export",
          pricingType: "fixed" as const,
          price: 0,
        },
      ],
    },

    /*
     * The **template** catalogue. Three, one per template category with products
     * in it, because `/templates` demoing as an empty grid is the same failure as
     * the four legal stubs that shipped rendering nothing.
     *
     * One of them is free, so the FREE badge and `?free=true` are exercised in
     * both catalogues rather than only in the one that happens to be the default.
     */
    {
      slug: "meridian-admin",
      name: "Meridian Admin",
      summary: "A dark-first admin dashboard with the tables, charts and forms already built.",
      catalogue: "template" as const,
      category: "Admin dashboards",
      industry: "Finance",
      tech: ["Tailwind CSS", "Next.js"],
      price: 59,
      adapted: 11,
      areas: ["Branding", "Extra chart types", "Dark mode tuning"],
    },
    {
      slug: "vitrine-storefront",
      name: "Vitrine Storefront",
      summary: "Product, basket and checkout pages, responsive and ready to wire up.",
      catalogue: "template" as const,
      category: "Ecommerce pages",
      industry: "Retail",
      tech: ["Bootstrap"],
      price: 39,
      adapted: 8,
      areas: ["Branding", "Extra product layouts"],
    },
    {
      /*
       * The **pair** fixture: this is the front-end of `atlas-crm`.
       *
       * Atlas is the one to pair with — already £299 with a fulfilled order and an
       * entitlement — so the banner on this page reads "Atlas CRM — the complete
       * application · £299.00", which is exactly the case the feature exists for.
       *
       * Priced lower on purpose. The interesting demo is two prices for one app,
       * not two listings at the same one.
       */
      slug: "atlas-crm-template",
      name: "Atlas CRM",
      summary: "The Atlas CRM front-end on its own — the screens, without the backend.",
      catalogue: "template" as const,
      category: "Admin dashboards",
      industry: "Property",
      tech: ["Tailwind CSS"],
      price: 79,
      adapted: 2,
      areas: ["Branding", "Extra screens"],
      linkTo: "atlas-crm",
    },
    {
      slug: "atrium-corporate",
      name: "Atrium Corporate",
      summary: "A company site — services, team, case studies and contact — free to use.",
      catalogue: "template" as const,
      category: "Corporate & business",
      industry: "Property",
      tech: ["Tailwind CSS"],
      price: 0,
      adapted: 3,
      areas: ["Branding", "Extra page layouts"],
    },
  ];

  for (const p of products) {
    const product = await M.Product.findOneAndUpdate(
      { slug: p.slug },
      {
        $set: {
          name: p.name,
          summary: p.summary,
          status: "published",
          publishedAt: new Date(),
          // Stated per product. Defaulting would make every template a script
          // until somebody edited it, and `/templates` would seed empty.
          catalogue: "catalogue" in p && p.catalogue ? p.catalogue : "script",
          categoryIds: [tax("category", p.category)],
          industryIds: [tax("industry", p.industry)],
          technologyIds: p.tech.map((t) => tax("technology", t)),
          // Scripts are complete applications; a template is not one, and typing
          // it as such would put it under the wrong facet in its own rail.
          // `productTypeId` is optional, so leaving it unset is the honest answer
          // until there is a template type vocabulary worth having.
          ...("catalogue" in p && p.catalogue === "template"
            ? {}
            : { productTypeId: tax("product_type", "Complete application") }),
          facets: M.buildProductFacets({
            categorySlugs: [slugify(p.category)],
            industrySlugs: [slugify(p.industry)],
            technologySlugs: p.tech.map(slugify),
            ...("catalogue" in p && p.catalogue === "template"
              ? {}
              : { productTypeSlug: slugify("Complete application") }),
          }),
          features: [
            { title: "Role-based access" },
            { title: "Reporting dashboard" },
            { title: "Email notifications" },
          ],
          media: seedMedia(p.slug, p.name),
          prices: everyCurrency(p.price),
          licencePackages: [
            {
              key: "single",
              name: "Single installation",
              licenceType: "single_installation",
              activationLimit: 1,
              supportMonths: 12,
              updateMonths: 12,
              // Every currency the product advertises, not just GBP.
              // `product.prices` is what the marketplace lists and filters on;
              // *this* is what the cart builds a line from. When they disagree,
              // the listing shows a price nobody can check out with — which is
              // exactly what happened to a customer browsing in USD.
              // `readiness.ts` now refuses to publish a product in that state.
              prices: everyCurrency(p.price),
            },
          ],
          // Most products take the two platform services; a product may name its
          // own instead, which is how the free-tier fixture carries a paid plugin
          // and a free one.
          addons:
            "addons" in p && p.addons
              ? p.addons.map((addon) => ({
                  key: addon.key,
                  name: addon.name,
                  pricingType: addon.pricingType,
                  prices: everyCurrency(addon.price),
                }))
              : [
                  {
                    key: "installation",
                    name: "Installation",
                    pricingType: "fixed",
                    prices: everyCurrency(99),
                  },
                  {
                    key: "branding",
                    name: "Brand setup",
                    pricingType: "fixed",
                    prices: everyCurrency(49),
                  },
                ],
          customization: {
            available: true,
            aiWorkflowEnabled: true,
            technicalReviewRequired: true,
            suggestedAreas: p.areas,
          },
          installation: { selfInstall: true, innovatrixInstall: true, managedHosting: false },
          adaptedCount: p.adapted,
          orderCount: p.adapted * 2,
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();

    /*
     * Demo config — §9.
     *
     * Written in a second pass because the passwords are sealed with the
     * **product id as AAD**, which does not exist until the upsert above has
     * run. That binding is the point: a ciphertext copied to another product
     * does not decrypt there.
     *
     * Sealed with the same `seal()` the demo service uses, so what lands here
     * is byte-for-byte what the admin form would have written — a seed that
     * stores plaintext would make every §89 assertion vacuous.
     */
    if (p.demo) {
      const productId = String(product!._id);
      await M.Product.updateOne(
        { _id: product!._id },
        {
          $set: {
            "demo.exposure": p.demo.exposure,
            "demo.instructions": p.demo.instructions,
            "demo.resetSchedule": p.demo.resetSchedule,
            ...("publicUrl" in p.demo ? { "demo.publicUrl": p.demo.publicUrl } : {}),
            ...("customerUrl" in p.demo ? { "demo.customerUrl": p.demo.customerUrl } : {}),
            ...("adminUrl" in p.demo ? { "demo.adminUrl": p.demo.adminUrl } : {}),
            "demo.credentials": p.demo.credentials.map((credential) => ({
              role: credential.role,
              ...("label" in credential ? { label: credential.label } : {}),
              username: credential.username,
              passwordCipher: seal(credential.password, productId),
            })),
          },
        },
      );
    }

    const version = await M.ProductVersion.findOneAndUpdate(
      { productId: product!._id, version: "1.0.0" },
      {
        $set: {
          status: "released",
          releasedAt: new Date(),
          // A node tree, not a string — `releaseNotes` became rich text in
          // ticket 07 and the field is `Mixed`, so a string would be accepted
          // and then render as nothing.
          releaseNotes: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "First public release." }],
              },
            ],
          },
          changelog: "First public release",
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();

    await M.Product.updateOne(
      { _id: product!._id },
      { $set: { currentVersionId: version!._id } },
    );

    await seedDownloadableFile(String(product!._id), String(version!._id), product!.slug);
  }

  /*
   * Link the pair — a second pass, because the target's `_id` does not exist until
   * its own upsert has run. The same reason `currentVersionId` is written above
   * rather than inside the product upsert.
   *
   * Idempotent: `$set` to the same id on a re-seed is a no-op, and the partial
   * unique index would refuse a second template for one script anyway.
   */
  let linked = 0;
  for (const p of products) {
    if (!("linkTo" in p) || !p.linkTo) continue;

    const template = await M.Product.findOne({ slug: p.slug }).select({ _id: 1 }).lean();
    const script = await M.Product.findOne({ slug: p.linkTo }).select({ _id: 1 }).lean();
    if (!template || !script) continue;

    await M.Product.updateOne({ _id: template._id }, { $set: { scriptListingId: script._id } });
    linked += 1;
  }

  console.log(`products: ${products.length}`);
  if (linked > 0) console.log(`linked template pairs: ${linked}`);
  console.log(
    storageSkipReason
      ? `release files: skipped — storage not configured (${storageSkipReason})`
      : `release files: ${filesUploaded} uploaded`,
  );

  /* ── one paid order, so the dashboard isn't empty ─────────── */
  const atlas = await M.Product.findOne({ slug: "atlas-crm" }).lean();
  const atlasVersion = await M.ProductVersion.findOne({ productId: atlas!._id }).lean();
  const orderRef = formatReference("ORD", 2026, 1);
  const price = fromDecimal(299, "GBP");

  const order = await M.Order.findOneAndUpdate(
    { reference: orderRef },
    {
      $set: {
        organizationId: org!._id,
        userId: customer!._id,
        currency: "GBP",
        status: "fulfilled",
        paidAt: new Date(),
        fulfilledAt: new Date(),
        items: [
          {
            lineId: "line-1",
            kind: "product_licence",
            productId: atlas!._id,
            productName: atlas!.name,
            productSlug: atlas!.slug,
            versionId: atlasVersion!._id,
            versionNumber: atlasVersion!.version,
            licencePackageKey: "single",
            licencePackageName: "Single installation",
            licenceType: "single_installation",
            activationLimit: 1,
            supportMonths: 12,
            updateMonths: 12,
            quantity: 1,
            unitPrice: price,
            lineTotal: price,
          },
        ],
        subtotal: price,
        total: price,
        billingSnapshot: { organizationName: org!.name, country: "GB" },
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();

  const entitlement = await M.Entitlement.findOneAndUpdate(
    { orderId: order!._id, orderLineId: "line-1" },
    {
      $set: {
        organizationId: org!._id,
        productId: atlas!._id,
        purchasedVersionId: atlasVersion!._id,
        updatesUntil: new Date(Date.now() + 365 * 864e5),
        supportUntil: new Date(Date.now() + 365 * 864e5),
        status: "active",
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();

  /*
   * A **stable, valid** demo key.
   *
   * It was hard-coded as `INVX-SEED-0001-DEMO-0001`, which ticket 14 then made
   * impossible: `0` and `1` are not in the alphabet (they are the characters
   * people mishear), and there was no check character. So the seeded licence
   * failed `isValidLicenceKeyFormat` and the activation endpoint refused it as
   * a typo — a demo licence that cannot be activated.
   *
   * Built from a fixed body plus a computed check character rather than
   * `generateLicenceKey()`: the seed upserts on the key, so a random one would
   * create a new licence on every run. Computing the check digit means the seed
   * follows the checksum if it ever changes.
   */
  const seedKeyBody = "SEEDDEMKEY2345A";
  const seedKey = `INVX-${[0, 4, 8, 12]
    .map((at) => (seedKeyBody + checkCharacter(seedKeyBody)).slice(at, at + 4))
    .join("-")}`;

  // Keyed on `key`, not `entitlementId`. `key` is what carries the unique
  // index, so upserting on anything else means a re-run that finds no matching
  // entitlement tries to insert a *second* licence with the same key and dies
  // on E11000 — which is exactly what happened after a test deleted the seeded
  // entitlement. Upsert on the unique field or the upsert is not one.
  await M.Licence.findOneAndUpdate(
    { key: seedKey },
    {
      $set: {
        key: seedKey,
        entitlementId: entitlement!._id,
        organizationId: org!._id,
        productId: atlas!._id,
        type: "single_installation",
        activationLimit: 1,
        status: "active",
        supportExpiresAt: new Date(Date.now() + 365 * 864e5),
        // Reset, because releasing an activation stamps `releasedAt` rather
        // than deleting the row (§65 — the history is the point). Left alone,
        // every activation anyone tried accumulates on the demo licence for the
        // life of the database, and "running it twice changes nothing" stops
        // being true of the one document people poke at most.
        activations: [],
      },
    },
    { upsert: true, returnDocument: "after" },
  );

  // Keep the reference counter ahead of what we just seeded, or the first real
  // order would collide with ORD-2026-0001.
  await mongoose.connection
    .collection("counters")
    .updateOne({ _id: "reference:ORD:2026" as never }, { $max: { seq: 1 } }, { upsert: true });

  console.log(`order: ${orderRef} (fulfilled, 1 entitlement, 1 licence)`);

  // Awaited explicitly: autoIndex builds in the background, and a short script
  // can exit before the compound and text indexes finish — leaving the
  /* ── tax rules (ticket 10) ──────────────────────────────── */
  // Real rates, so the checkout path is exercised rather than assumed. Editable
  // in /admin/settings/tax; the order snapshots whatever applied at the time.
  const taxRules = [
    {
      ruleId: "uk-digital-vat-20",
      label: "UK VAT — digital goods",
      country: "GB",
      kind: "digital" as const,
      basisPoints: 2000,
      priority: 10,
    },
    {
      ruleId: "uk-service-vat-20",
      label: "UK VAT — services",
      country: "GB",
      kind: "service" as const,
      basisPoints: 2000,
      priority: 10,
    },
    {
      ruleId: "ng-vat-7-5",
      label: "Nigeria VAT",
      country: "NG",
      kind: "any" as const,
      basisPoints: 750,
      priority: 10,
    },
    {
      // The catch-all. Priority 0 so any country rule beats it, and zero-rated
      // so an unconfigured country charges nothing rather than guessing.
      ruleId: "rest-of-world-zero",
      label: "No tax configured",
      country: "*",
      kind: "any" as const,
      basisPoints: 0,
      priority: 0,
    },
  ];

  for (const rule of taxRules) {
    await M.TaxRule.findOneAndUpdate(
      { ruleId: rule.ruleId },
      { $set: { ...rule, isActive: true } },
      { upsert: true },
    );
  }
  console.log(`tax rules: ${taxRules.length}`);

  /* ── discount codes (ticket 10) ─────────────────────────── */
  const discounts = [
    {
      code: "LAUNCH15",
      description: "15% off anything, launch promotion",
      kind: "percentage" as const,
      value: 1500,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
    },
    {
      code: "SAVE50",
      description: "£50 off orders over £300",
      kind: "fixed" as const,
      value: 5000,
      currency: "GBP",
      minSpend: { amount: 30_000, currency: "GBP" },
    },
    {
      // Deliberately exhausted, so the "over-limit code is rejected at
      // recalculation" path has something real to reject.
      code: "SOLDOUT",
      description: "Exhausted — fixture for the usage-limit path",
      kind: "percentage" as const,
      value: 5000,
      usageLimit: 1,
      usedCount: 1,
    },
    {
      code: "EXPIRED10",
      description: "Expired — fixture for the expiry path",
      kind: "percentage" as const,
      value: 1000,
      expiresAt: new Date(Date.now() - 86_400_000),
    },
  ];

  for (const discount of discounts) {
    await M.DiscountCode.findOneAndUpdate(
      { code: discount.code },
      { $setOnInsert: { ...discount, isActive: true } },
      { upsert: true },
    );
  }
  console.log(`discount codes: ${discounts.length}`);

  /* ── payment settings (ticket 12, smoke ticket 05) ──────── */

  /*
   * Seeded so a fresh database has a coherent payments screen rather than one
   * where every provider is disabled and every currency uncovered. Ticket 29's
   * §A1 says "check out, paying by card" as though that were possible out of
   * the box; without this, the tester has to configure a provider first.
   *
   * `$setOnInsert` throughout: this must never overwrite what a real
   * environment has been configured with, and `supportedCurrencies` in
   * particular is the one field that describes *this merchant's* account
   * rather than the driver's capabilities.
   *
   * Nothing is enabled. Enabling a provider whose key is absent produces the
   * "enabled but not configured" warning on the screen, which would be a seed
   * shipping a fault.
   */
  await M.PaymentSettings.findOneAndUpdate(
    { singleton: "global" },
    {
      $setOnInsert: {
        singleton: "global",
        providers: [
          { key: "stripe", enabled: false, mode: "test", secretEnvVar: "STRIPE_SECRET_KEY" },
          {
            key: "paystack",
            enabled: false,
            mode: "test",
            secretEnvVar: "PAYSTACK_SECRET_KEY",
          },
          { key: "paypal", enabled: false, mode: "test", secretEnvVar: "PAYPAL_CLIENT_SECRET" },
        ],
        currencyRouting: [],
        offlineEnabled: true,
        offlineInstructions:
          `Pay by bank transfer to ${BRAND.legalName}, sort code 00-00-00, account 00000000. ` +
          "Quote your order reference so we can match the payment. Nothing is released " +
          "until the transfer arrives.",
      },
    },
    { upsert: true },
  );
  console.log("payment settings: seeded (all providers off, bank transfer on)");

  // marketplace query collection-scanning with no visible symptom.
  console.log("\nsyncing indexes…");
  await syncAllIndexes();

  console.log("\nseed complete.");
  console.log(`  staff:      ${staff.length} accounts, one per role — see README.md`);
  console.log(`  customers:  ${colleagues.length + 1} in Brightpath Care (owner … member)`);
  console.log(`  password:   ${DEMO_PASSWORD}  (every account)`);

  await mongoose.disconnect();
}

/**
 * Screenshots for a seeded product — and one video, on purpose.
 *
 * ## Why the seed had none at all
 *
 * `seed.ts` wrote no `media`, so on a freshly seeded database the product page's
 * entire hero block — the `<Image priority>` LCP element and the gallery beside
 * it — was `{hero && …}` with `hero` undefined, and simply never rendered. Every
 * change to either was therefore verified against `seed-bulk`'s catalogue or
 * against nothing.
 *
 * ## 1600×900, not 800×500
 *
 * The hero renders at up to 780px wide on a `lg` layout and the lightbox at up to
 * 1280px, so an 800px source is a 1.6× upscale in the one place somebody opens to
 * look closely. `picsum.photos/seed/<slug>-<n>` is deterministic, so the
 * catalogue looks the same on every machine.
 *
 * ## The video entry, and where it sits in the array
 *
 * `roster` gets one, because a mixed list is the only thing that makes the
 * `screenshots()` filter observable: at `sortOrder: 0` it sorts to the front of
 * `ProductDetail.media`, which is exactly the arrangement that used to render an
 * `<Image src="…mp4">` as the LCP element and hand the same URL to every crawler
 * as the Open Graph image.
 *
 * It is placed **last in the array** even so, which looks inconsistent and is
 * deliberate: `CARD_PROJECTION` takes the card thumbnail with
 * `{ $slice: ["$media", 1] }` — document order, with no way to filter by `kind` —
 * so a video first in the array would give `roster` a broken image on every
 * marketplace grid. That is a real bug, in a different file, waiting for its own
 * diff; seeding data that triggers it would make the whole grid look broken and
 * teach everyone to ignore it.
 */
function seedMedia(slug: string, name: string) {
  // Atlas is the walkthrough product, so it is the one that needs enough
  // screenshots for the strip, the counter and wrap-around to be worth looking at.
  const count = slug === "atlas-crm" ? 5 : 3;

  const shots = Array.from({ length: count }, (_, index) => ({
    kind: "screenshot" as const,
    url: `https://picsum.photos/seed/${slug}-${index + 1}/1600/900`,
    // Never blank: an unlabelled screenshot fails AA, and the seed should look
    // like what the admin form would have written rather than like a shortcut.
    alt: `${name} — screenshot ${index + 1}`,
    sortOrder: index + 1,
    isPrimary: index === 0,
  }));

  if (slug !== "roster") return shots;

  return [
    ...shots,
    {
      kind: "video" as const,
      url: "https://example.test/roster-walkthrough.mp4",
      alt: `${name} — product walkthrough`,
      sortOrder: 0,
      isPrimary: false,
    },
  ];
}

main().catch(async (error) => {
  console.error("\nseed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
