/**
 * The vendor lifecycle, end to end, against the configured database.
 *
 *   npm run vendors:probe
 *
 * Vendor tickets 01–09. The integration suite proves the same rules against an
 * ephemeral replica set; this runs them against the database the dev server
 * actually reads, so the screens can be opened afterwards and looked at. That is
 * the gap it fills — a test can assert a status field, and only a person can tell
 * you the status screen reads like a sentence.
 *
 * Idempotent: it removes the vendor it made last time before making a new one, so
 * it can be re-run while iterating on the screens.
 */
import "dotenv/config";

const SEED_EMAIL = "amara@brightpath.test";

async function main() {
  const { connectToDatabase } = await import("@/lib/db/client");
  const { User } = await import("@/lib/db/models/identity");
  const { Vendor, VendorMember, VendorInvitation } = await import("@/lib/db/models/vendors");
  const vendorService = await import("@/services/vendors/vendor-service");
  const memberService = await import("@/services/vendors/member-service");

  const pass = (m: string) => console.log(`  ✓ ${m}`);
  const fail = (m: string) => {
    console.log(`  ✗ ${m}`);
    process.exitCode = 1;
  };

  await connectToDatabase();

  const user = await User.findOne({ email: SEED_EMAIL }).lean<{
    _id: unknown;
    name?: string;
  }>();
  if (!user) {
    console.error(`No seeded user ${SEED_EMAIL}. Run \`npm run db:seed\` first.`);
    process.exit(1);
  }
  const userId = String(user._id);

  // Clean up the previous run.
  for (const member of await VendorMember.find({ userId }).lean()) {
    await VendorInvitation.deleteMany({ vendorId: member.vendorId });
    await Vendor.deleteOne({ _id: member.vendorId });
  }
  await VendorMember.deleteMany({ userId });

  console.log(`applicant : ${SEED_EMAIL}\n`);

  /* 1. apply */
  const vendor = await vendorService.apply(
    {
      displayName: "Brightpath Tools",
      contactEmail: SEED_EMAIL,
      country: "GB",
      pitch:
        "We build lightweight inventory and dispatch tooling for independent " +
        "distributors, mostly PHP and Postgres, biased toward things that run on " +
        "cheap hosting.",
    },
    { id: userId, ...(user.name ? { name: user.name } : {}) },
  );
  const id = String(vendor._id);

  vendor.status === "applied"
    ? pass(`applied — slug ${vendor.slug}`)
    : fail(`expected applied, got ${vendor.status}`);

  vendor.agreement?.version
    ? pass(`agreement ${vendor.agreement.version} recorded against the applicant`)
    : fail("no agreement recorded");

  /* 2. the owner membership exists, because a vendor without one is unrepairable */
  const members = await VendorMember.find({ vendorId: vendor._id }).lean();
  members.length === 1 && members[0]!.role === "owner" && members[0]!.status === "active"
    ? pass("owner membership created in the same transaction")
    : fail(`expected one active owner, got ${JSON.stringify(members.map((m) => m.role))}`);

  /* 3. one vendor per person */
  try {
    await vendorService.apply(
      {
        displayName: "Second Go",
        contactEmail: SEED_EMAIL,
        country: "GB",
        pitch: "x".repeat(50),
      },
      { id: userId },
    );
    fail("a second vendor was allowed for the same person");
  } catch {
    pass("a second vendor for the same person is refused");
  }

  /* 4. the verification gate on `verified` */
  await vendorService.transition(id, "in_review", staff(userId));
  pass("moved to in_review");

  try {
    await vendorService.transition(id, "verified", staff(userId));
    fail("verified without identity approval — the listing gate is open");
  } catch {
    pass("cannot verify before identity is approved");
  }

  await vendorService.decideVerification(
    id,
    { level: "identity", outcome: "approved", documentHashes: ["probe-hash"] },
    { ...staff(userId) },
  );
  pass("identity approved");

  const verified = await vendorService.transition(id, "verified", staff(userId));
  verified.status === "verified" && verified.verifiedAt
    ? pass("verified, and the date is stamped")
    : fail("verification did not complete");

  /* 5. an invitation, and the wrong-recipient refusal */
  const invitation = await memberService.invite(
    id,
    { email: "someone-else@example.test", role: "member" },
    { type: "vendor", userId, vendorId: id },
  );
  pass(`invitation created, expires ${invitation.expiresAt.toISOString()}`);

  try {
    await memberService.acceptInvitation(String(invitation._id), {
      id: userId,
      email: SEED_EMAIL,
      emailVerified: true,
    });
    fail("an invitation was accepted by the wrong address");
  } catch {
    pass("an invitation cannot be accepted by a different address");
  }

  /* 6. product ownership — vendor ticket 04 */
  const productService = await import("@/services/catalog/product-service");
  const { Product } = await import("@/lib/db/models/catalog");
  const { products } = await import("@/repositories/product.repository");

  await Product.deleteMany({ vendorId: vendor._id });

  const product = await productService.createDraft(
    {
      name: "Brightpath Dispatch",
      summary: "Dispatch and route planning for small distributors.",
      vendor: { id, slug: vendor.slug, name: vendor.displayName },
    },
    { type: "vendor", userId, vendorId: id },
  );
  const productId = String(product._id);

  product.vendorSlug === vendor.slug && product.vendorName === vendor.displayName
    ? pass("draft created, owned by this vendor")
    : fail("ownership was not stamped on the draft");

  // The `vend:` term has to exist from creation, not from the first classification
  // save — otherwise the product is invisible on its own storefront in between.
  product.facets.includes(`vend:${vendor.slug}`)
    ? pass(`facets carry vend:${vendor.slug} from creation`)
    : fail(`facets are ${JSON.stringify(product.facets)} — the vendor term is missing`);

  const mine = await productService.listForVendor({ vendorId: id });
  mine.total === 1
    ? pass("appears in this vendor's own list")
    : fail("not in the vendor's list");

  /* 7. the trap: a classification save must not wipe the vendor term */
  await productService.saveClassification(
    productId,
    { categoryIds: [], industryIds: [], technologyIds: [] },
    { type: "vendor", userId, vendorId: id },
    { vendorId: id },
  );
  const afterClassification = await Product.findById(productId).lean();
  afterClassification!.facets.includes(`vend:${vendor.slug}`)
    ? pass("the vendor term survives a classification save")
    : fail("the vendor term was wiped by a classification save — storefront now empty");

  /* 8. cross-vendor writes are refused as 404 */
  const OTHER_VENDOR = "652f1a2b3c4d5e6f70819299";
  try {
    await productService.saveSection(
      productId,
      "basics",
      { name: "Hijacked" },
      { type: "vendor", userId, vendorId: OTHER_VENDOR },
      { vendorId: OTHER_VENDOR },
    );
    fail("another vendor wrote to this product");
  } catch (e) {
    (e as Error).name === "NotFoundError"
      ? pass("another vendor's write is refused as a 404, not a 403")
      : fail(`expected NotFoundError, got ${(e as Error).name}`);
  }

  const untouched = await Product.findById(productId).lean();
  untouched!.name === "Brightpath Dispatch"
    ? pass("and nothing was written")
    : fail("the cross-vendor write landed anyway");

  /*
   * 9. a first-party product is not a vendor's product.
   *
   * The case that actually caught a real leak: absence of `vendorId` must not read as
   * "mine". A dev server whose schema predated the field dropped the filter under
   * `strictQuery` and served a vendor an CoSetup product's edit form, so this is
   * checked against the live database rather than assumed from the type.
   */
  const firstParty = await Product.findOne({ vendorId: { $exists: false } })
    .select({ _id: 1, name: 1 })
    .lean();

  if (!firstParty) {
    console.log("  ! no first-party product to test against — run `npm run db:seed`");
  } else {
    const leaked = await products.findScoped(String(firstParty._id), { vendorId: id });
    leaked
      ? fail(`a first-party product (${leaked.name}) is visible to a vendor`)
      : pass("a first-party product is not visible to a vendor");
  }

  /* 10. a blank scope must throw rather than widen */
  try {
    await productService.listForVendor({ vendorId: "" });
    fail("a blank vendor scope listed every vendor's products");
  } catch (e) {
    (e as Error).name === "ScopeError"
      ? pass("a blank vendor scope throws rather than widening")
      : fail(`expected ScopeError, got ${(e as Error).name}`);
  }

  /* 11. submission and review — vendor ticket 05 */
  const reviewService = await import("@/services/catalog/review-service");

  // The submission gate is the publication gate, so a draft with nothing on it is
  // refused — and that refusal naming a real gap is the useful half.
  try {
    await reviewService.submit(
      { productId, scope: { vendorId: id }, attested: true },
      { type: "vendor", userId, vendorId: id },
    );
    fail("an incomplete product was submitted");
  } catch (e) {
    /(price|screenshot|description|version)/i.test((e as Error).message)
      ? pass("submission is refused while readiness reports a gap, and names it")
      : fail(`expected a readiness message, got: ${(e as Error).message}`);
  }

  try {
    await reviewService.submit(
      { productId, scope: { vendorId: id }, attested: false },
      { type: "vendor", userId, vendorId: id },
    );
    fail("a product was submitted without the attestation");
  } catch {
    pass("submission is refused without the attestation");
  }

  // Make it submittable, then walk the cycle.
  await Product.updateOne(
    { _id: productId },
    {
      $set: {
        description: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "What it does." }] }],
        },
        descriptionText: "What it does.",
        prices: [{ currency: "GBP", amount: 19900 }],
        licencePackages: [
          {
            key: "single",
            name: "Single installation",
            licenceType: "single_installation",
            activationLimit: 1,
            supportMonths: 12,
            updateMonths: 12,
            prices: [{ currency: "GBP", amount: 19900 }],
          },
        ],
        media: [
          {
            kind: "screenshot",
            url: "https://example.test/a.png",
            sortOrder: 0,
            isPrimary: true,
          },
        ],
        testingChecklist: [{ item: "Installs cleanly", status: "pass" }],
      },
    },
  );

  const { ProductVersion, ProductFile } = await import("@/lib/db/models/catalog");
  const [version] = await ProductVersion.create([
    { productId, version: "1.0.0", status: "released", releasedAt: new Date() },
  ]);
  await ProductFile.create([
    {
      productId,
      versionId: version!._id,
      kind: "application_package",
      storageKey: `probe/${productId}/pkg.zip`,
      filename: "pkg.zip",
      contentType: "application/zip",
      sizeBytes: 1024,
      scanStatus: "pending",
    },
  ]);
  await Product.updateOne({ _id: productId }, { $set: { currentVersionId: version!._id } });

  const submitted = await reviewService.submit(
    { productId, scope: { vendorId: id }, attested: true },
    { type: "vendor", userId, vendorId: id },
  );
  submitted.status === "submitted"
    ? pass("submitted, with the attestation recorded")
    : fail(`expected submitted, got ${submitted.status}`);

  // The ceiling on a vendor, asserted rather than assumed absent from a screen.
  try {
    await productService.transition(productId, "internal_review", {
      type: "vendor",
      userId,
      vendorId: id,
    });
    fail("a vendor claimed their own submission");
  } catch (e) {
    (e as Error).name === "ForbiddenError"
      ? pass("a vendor cannot move a product past submitted")
      : fail(`expected ForbiddenError, got ${(e as Error).name}`);
  }

  const INTERNAL = "Probe internal note — must never reach the vendor.";
  await reviewService.requestChanges(
    {
      productId,
      reasons: ["metadata"],
      detail: "The summary needs to say what it does.",
      internalNote: INTERNAL,
    },
    { ...staff(userId) },
  );

  const afterReview = await Product.findById(productId).lean();
  afterReview!.status === "changes_requested"
    ? pass("sent back as changes_requested")
    : fail(`expected changes_requested, got ${afterReview!.status}`);

  // §37, against the real projection rather than the intent.
  const view = await import("@/services/catalog/product-view");
  const vendorPayload = JSON.stringify(view.toVendorReviewNotes(afterReview!));
  !vendorPayload.includes(INTERNAL) && !vendorPayload.includes("internalNote")
    ? pass("the internal note is absent from the vendor projection")
    : fail("an internal note reached the vendor projection");

  view.toStaffReviewNotes(afterReview!).at(-1)?.internalNote === INTERNAL
    ? pass("and staff can still read it")
    : fail("staff cannot read the internal note they wrote");

  const resubmitted = await reviewService.submit(
    { productId, scope: { vendorId: id }, attested: true },
    { type: "vendor", userId, vendorId: id },
  );
  resubmitted.status === "submitted"
    ? pass("resubmitted after changes")
    : fail("resubmission failed");

  const withHistory = await Product.findById(productId).lean();
  withHistory!.reviewNotes.length >= 3
    ? pass(`review notes accumulate (${withHistory!.reviewNotes.length} entries)`)
    : fail("review notes were overwritten rather than appended");

  await reviewService.approve({ productId, detail: "Looks good." }, { ...staff(userId) });
  const approved = await Product.findById(productId).lean();
  approved!.status === "internal_review"
    ? pass("approved into internal_review — not straight onto sale")
    : fail(`expected internal_review, got ${approved!.status}`);

  /* 6. the money — vendor tickets 07 and 08 */

  console.log("\ncommission and earnings");

  const commission = await import("@/services/vendors/commission-service");
  const ledger = await import("@/services/vendors/ledger-service");
  const { Order } = await import("@/lib/db/models/commerce");
  const { LedgerEntry } = await import("@/lib/db/models/ledger");

  // Previous runs, cleaned through the driver: deletion is refused on the model by design,
  // and relaxing that for a probe would remove the guarantee it is meant to demonstrate.
  await LedgerEntry.collection.deleteMany({ vendorId: vendor._id });
  await Order.deleteMany({ reference: "ORD-PROBE-0001" });

  await commission.setVendorCommission(id, 2500, staff(userId));
  const rate = await commission.resolveCommissionForVendor(id);
  rate.basisPoints === 2500 && rate.source === "vendor"
    ? pass(`the vendor override wins — ${commission.formatRate(rate.basisPoints)}`)
    : fail(`expected a 2500 vendor rate, got ${rate.basisPoints} from ${rate.source}`);

  await commission.setVendorCommission(id, null, staff(userId));
  const cleared = await commission.resolveCommissionForVendor(id);
  cleared.source === "platform"
    ? pass(
        `cleared, so the platform rate applies — ${commission.formatRate(cleared.basisPoints)}`,
      )
    : fail("clearing the override did not fall back to the platform rate");

  // A paid order carrying one of this vendor's lines. Written directly rather than through
  // checkout: the probe is about the ledger, and `checkout.integration.test.ts` owns the
  // question of whether the snapshot lands.
  const [order] = await Order.create([
    {
      reference: "ORD-PROBE-0001",
      organizationId: userId,
      userId,
      currency: "GBP",
      items: [
        {
          lineId: "line-1",
          kind: "product_licence",
          productId,
          productName: "Brightpath Dispatch",
          productSlug: "brightpath-dispatch",
          quantity: 1,
          unitPrice: { amount: 10_000, currency: "GBP" },
          lineTotal: { amount: 10_000, currency: "GBP" },
          vendorId: vendor._id,
          commissionBasisPoints: cleared.basisPoints,
        },
      ],
      subtotal: { amount: 10_000, currency: "GBP" },
      total: { amount: 10_000, currency: "GBP" },
      status: "paid",
      paidAt: new Date(),
      billingSnapshot: { country: "GB" },
      paymentMethod: "online",
    },
  ]);

  const { written } = await ledger.recordEarnings(order!.toObject(), undefined);
  written === 1 ? pass("one earning written for the vendor line") : fail("no earning written");

  try {
    await ledger.recordEarnings(order!.toObject(), undefined);
    fail("a second earning was written for the same line");
  } catch {
    pass("a retried write is refused by the unique index");
  }

  const [balance] = await ledger.balanceFor({ vendorId: id });
  const expected = 10_000 - Math.round((10_000 * cleared.basisPoints) / 10_000);
  balance?.pending === expected
    ? pass(`pending balance is ${expected} minor units, and nothing is payable yet`)
    : fail(`expected ${expected} pending, got ${balance?.pending}`);

  balance?.cleared === 0
    ? pass("nothing clears before its date, so nothing is payable")
    : fail(`expected 0 cleared, got ${balance?.cleared}`);

  try {
    await LedgerEntry.deleteMany({ vendorId: vendor._id });
    fail("the ledger allowed a deletion");
  } catch {
    pass("the ledger refuses deletion — append-only, on the model");
  }

  await ledger.recordAdjustment(
    { vendorId: id, amount: { amount: -500, currency: "GBP" }, note: "Probe chargeback fee." },
    staff(userId),
  );
  const [afterAdjustment] = await ledger.balanceFor({ vendorId: id });
  afterAdjustment?.cleared === -500
    ? pass("an adjustment is immediately payable, and can be negative")
    : fail(`expected -500 cleared, got ${afterAdjustment?.cleared}`);

  const recon = await ledger.reconcile(new Date(Date.now() - 86_400_000), new Date());
  const row = recon.rows.find((candidate) => candidate.currency === "GBP");
  row && row.drift === 0 && row.missingEntries.length === 0
    ? pass(`reconciles with no drift over ${recon.ordersRead} order(s)`)
    : fail(`reconciliation drift ${row?.drift}, missing ${row?.missingEntries.length}`);

  /* 7. payouts — vendor ticket 09 */

  console.log("\npayouts");

  const payoutService = await import("@/services/payouts/payout-service");
  const statementService = await import("@/services/payouts/statement");
  const { Payout, PayoutSkip } = await import("@/lib/db/models/ledger");

  await Payout.deleteMany({ vendorId: vendor._id });
  await PayoutSkip.deleteMany({ vendorId: vendor._id });

  // Business verification is what gates a payout, and the walkthrough above only approved
  // identity — so the first run *should* skip, and that is the check.
  const firstRun = await payoutService.draftBatch();
  const skipped = firstRun.skipped.find((row) => row.vendorId === id);
  skipped?.reason === "unverified" || skipped?.reason === "no_account"
    ? pass(`skipped before verification — ${skipped.reason}`)
    : fail(`expected a skip with a reason, got ${JSON.stringify(skipped)}`);

  await vendorService.decideVerification(
    id,
    { level: "business", outcome: "approved", documentHashes: [] },
    staff(userId),
  );
  await vendorService.savePayoutAccount(
    id,
    {
      accountName: "Brightpath Tools Ltd",
      accountIdentifier: "12345678",
      bankName: "Example Bank",
      country: "GB",
    },
    { type: "vendor", userId, vendorId: id },
  );

  // Saving the account holds payouts by design, so business verification has to be approved
  // *after* it for the probe to reach a draft. That ordering is the feature working.
  await vendorService.decideVerification(
    id,
    { level: "business", outcome: "approved", documentHashes: [] },
    staff(userId),
  );

  // The clearance sweep cannot be waited out, so the entry is aged directly.
  await LedgerEntry.updateMany(
    { vendorId: vendor._id, kind: "earning" },
    { $set: { status: "cleared" } },
  );

  const batch = await payoutService.draftBatch();
  const draft = batch.drafted.find((row) => row.vendorId === id);
  draft
    ? pass(`drafted ${draft.reference} for ${draft.amount.amount} minor units`)
    : fail(`no payout drafted: ${JSON.stringify(batch)}`);

  const rerun = await payoutService.draftBatch();
  rerun.drafted.some((row) => row.vendorId === id)
    ? fail("a second batch drafted a duplicate payout")
    : pass("a re-run drafts nothing — one payout per vendor per period");

  if (draft) {
    const payoutId = draft.payoutId;

    try {
      await payoutService.send(payoutId, staff(userId));
      fail("an unapproved payout was sent");
    } catch (e) {
      (e as Error).name === "StateTransitionError"
        ? pass("a draft cannot be sent before somebody approves it")
        : fail(`expected StateTransitionError, got ${(e as Error).name}`);
    }

    await payoutService.approve(payoutId, staff(userId));
    const sending = await payoutService.send(payoutId, staff(userId));
    sending.status === "sending"
      ? pass("approved, then sending — the manual driver waits for a person")
      : fail(`expected sending, got ${sending.status}`);

    const built = await statementService.buildStatement(sending, { includeAccount: true });
    const recon = statementService.statementReconciles(built);
    recon.ok
      ? pass(`statement reconciles across ${built.lines.length} line(s)`)
      : fail(`statement drift: line ${recon.lineDrift}, total ${recon.totalDrift}`);

    built.vendor.account?.masked === "••••5678"
      ? pass("the account is masked to its last four characters")
      : fail(`account not masked: ${JSON.stringify(built.vendor.account)}`);

    const paid = await payoutService.markPaid(
      payoutId,
      { externalReference: "FT-PROBE-0001" },
      staff(userId),
    );
    paid.status === "paid" ? pass("confirmed as paid") : fail("confirmation failed");

    const settled = await LedgerEntry.countDocuments({
      payoutId: paid._id,
      status: "paid",
    });
    settled === paid.entryIds.length
      ? pass(
          `${settled} ledger entr${settled === 1 ? "y" : "ies"} settled in the same transaction`,
        )
      : fail(`${settled} of ${paid.entryIds.length} entries settled`);

    const again = await payoutService.markPaid(payoutId, {}, staff(userId));
    again.externalReference === "FT-PROBE-0001"
      ? pass("a retried confirmation changes nothing")
      : fail("a retried confirmation overwrote the payout");

    const finalStatement = await statementService.buildStatement(again);
    finalStatement.final
      ? pass("the statement is final once paid")
      : fail("a paid payout's statement is not final");
  }

  console.log(
    [
      "",
      `vendor id  : ${id}`,
      `product id : ${productId}`,
      "",
      "Now look at these while signed in as the applicant:",
      "  /dashboard/selling                  — the overview, with a Selling group in the nav",
      "  /dashboard/selling/verification     — identity approved, business outstanding",
      "  /dashboard/selling/settings         — profile, with the slug fixed",
      "  /dashboard/selling/team             — the invitation waiting to be accepted",
      "  /dashboard/selling/products         — the product, with its readiness gaps",
      "  /dashboard/selling/earnings         — the rate, the three figures, the entries",
      "  /dashboard/selling/payouts          — the payout, with its statement",
      `  /dashboard/selling/products/${productId}/basics`,
      "",
      "And as market@innovatrix.test:",
      `  /staff/vendor-applications/${id}`,
      "  /admin/products                     — the Seller column, and ?vendor= to filter",
      "  /staff/vendor-submissions           — the review queue, oldest first",
      "  /admin/settings/commission          — the platform default rate",
      "  /admin/payouts                      — the queue, drafts first",
      `  /staff/vendor-submissions/${productId}`,
      "",
      process.exitCode ? "PROBE FAILED" : "probe complete — all checks passed",
    ].join("\n"),
  );

  process.exit(process.exitCode ?? 0);
}

/** A staff actor. The probe has no staff session, so it borrows the applicant's id. */
function staff(userId: string) {
  return { type: "staff" as const, userId, name: "Probe" };
}

main().catch((e) => {
  console.error("\nprobe error:", e);
  process.exit(1);
});
