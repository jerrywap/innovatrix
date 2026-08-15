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
import mongoose from "mongoose";
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

  /* ── staff (one per §77 role that the MVP actually uses) ── */
  const staff = [
    ["super@innovatrix.test", "Sam Okafor", "super_admin"],
    ["service@innovatrix.test", "Priya Raman", "customer_service"],
    ["analyst@innovatrix.test", "Tom Byrne", "technical_analyst"],
    ["market@innovatrix.test", "Lena Novak", "marketplace_manager"],
    ["finance@innovatrix.test", "Ade Bello", "finance"],
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
  }
  console.log(`staff: ${staff.length}`);

  /* ── a customer organization ─────────────────────────────── */
  const customer = await M.User.findOneAndUpdate(
    { email: "amara@brightpath.test" },
    { $set: { name: "Amara Okonjo", emailVerified: true } },
    { upsert: true, returnDocument: "after" },
  ).lean();

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
          prices: [
            { currency: "GBP", amount: fromDecimal(p.price, "GBP").amount },
            { currency: "USD", amount: fromDecimal(Math.round(p.price * 1.27), "USD").amount },
            { currency: "NGN", amount: fromDecimal(p.price * 2000, "NGN").amount },
          ],
          licencePackages: [
            {
              key: "single",
              name: "Single installation",
              licenceType: "single_installation",
              activationLimit: 1,
              supportMonths: 12,
              updateMonths: 12,
              prices: [{ currency: "GBP", amount: fromDecimal(p.price, "GBP").amount }],
            },
          ],
          addons: [
            {
              key: "installation",
              name: "Installation",
              pricingType: "fixed",
              prices: [{ currency: "GBP", amount: fromDecimal(99, "GBP").amount }],
            },
            {
              key: "branding",
              name: "Brand setup",
              pricingType: "fixed",
              prices: [{ currency: "GBP", amount: fromDecimal(49, "GBP").amount }],
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

    const version = await M.ProductVersion.findOneAndUpdate(
      { productId: product!._id, version: "1.0.0" },
      {
        $set: {
          status: "released",
          releasedAt: new Date(),
          releaseNotes: "Initial release.",
          changelog: "- First public release",
        },
      },
      { upsert: true, returnDocument: "after" },
    ).lean();

    await M.Product.updateOne(
      { _id: product!._id },
      { $set: { currentVersionId: version!._id } },
    );
  }
  console.log(`products: ${products.length}`);

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

  await M.Licence.findOneAndUpdate(
    { entitlementId: entitlement!._id },
    {
      $set: {
        key: "INVX-SEED-0001-DEMO-0001",
        organizationId: org!._id,
        productId: atlas!._id,
        type: "single_installation",
        activationLimit: 1,
        status: "active",
        supportExpiresAt: new Date(Date.now() + 365 * 864e5),
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
  // marketplace query collection-scanning with no visible symptom.
  console.log("\nsyncing indexes…");
  await syncAllIndexes();

  console.log("\nseed complete.");
  console.log("  customer: amara@brightpath.test");
  console.log("  staff:    super@innovatrix.test … finance@innovatrix.test");

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("\nseed failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
