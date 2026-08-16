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

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set — copy .env.example to .env.local");

  await mongoose.connect(uri, { dbName: process.env.MONGODB_DB_NAME ?? "innovatrix" });
  console.log("connected:", mongoose.connection.name);

  // Imported after connect so model registration happens on a live connection.
  const M = await import("../src/lib/db/models");

  /* ── taxonomies ─────────────────────────────────────────── */
  const taxonomies = [
    ...[
      "CRM",
      "Booking",
      "Property",
      "Healthcare",
      "Logistics",
      "HR & Rota",
      "E-commerce",
      "Finance",
    ].map((name, i) => ({ kind: "category" as const, name, sortOrder: i })),
    ...[
      "Healthcare",
      "Education",
      "Logistics",
      "Hospitality",
      "Property",
      "Finance",
      "Retail",
      "Nonprofit",
    ].map((name, i) => ({ kind: "industry" as const, name, sortOrder: i })),
    ...[
      "Laravel",
      "Next.js",
      "Django",
      "PostgreSQL",
      "MongoDB",
      "MySQL",
      "Redis",
      "Stripe",
    ].map((name, i) => ({ kind: "technology" as const, name, sortOrder: i })),
    ...["Complete application", "Script", "Admin panel", "Starter kit"].map((name, i) => ({
      kind: "product_type" as const,
      name,
      sortOrder: i,
    })),
  ];

  const slugify = (s: string) =>
    s
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

  const taxonomyIds = new Map<string, mongoose.Types.ObjectId>();
  for (const t of taxonomies) {
    const slug = slugify(t.name);
    const doc = await M.Taxonomy.findOneAndUpdate(
      { kind: t.kind, slug },
      { $set: { name: t.name, sortOrder: t.sortOrder, isActive: true } },
      { upsert: true, returnDocument: "after" },
    ).lean();
    taxonomyIds.set(`${t.kind}:${slug}`, doc!._id);
  }
  console.log(`taxonomies: ${taxonomyIds.size}`);

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
      `Innovatrix development placeholder for ${slug} v1.0.0.\n` +
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
          categoryIds: [tax("category", p.category)],
          industryIds: [tax("industry", p.industry)],
          technologyIds: p.tech.map((t) => tax("technology", t)),
          productTypeId: tax("product_type", "Complete application"),
          facets: M.buildProductFacets({
            categorySlugs: [slugify(p.category)],
            industrySlugs: [slugify(p.industry)],
            technologySlugs: p.tech.map(slugify),
            productTypeSlug: slugify("Complete application"),
          }),
          features: [
            { title: "Role-based access" },
            { title: "Reporting dashboard" },
            { title: "Email notifications" },
          ],
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
          addons: [
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
  console.log(`products: ${products.length}`);
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

  // marketplace query collection-scanning with no visible symptom.
  console.log("\nsyncing indexes…");
  await syncAllIndexes();

  console.log("\nseed complete.");
  console.log(`  staff:      ${staff.length} accounts, one per role — see README.md`);
  console.log(`  customers:  ${colleagues.length + 1} in Brightpath Care (owner … member)`);
  console.log(`  password:   ${DEMO_PASSWORD}  (every account)`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("\nseed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
