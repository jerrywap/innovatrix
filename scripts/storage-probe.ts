/**
 * Live storage round-trip against the configured bucket.
 *
 * Verifies the things unit tests cannot: that credentials work, that keys land
 * under our prefix and nowhere else, that the presigned URLs are actually
 * signed the way we think, and that an unsigned fetch is refused (§66).
 *
 *   npm run storage:probe
 */
import "dotenv/config";

async function main() {
  const { createUploadUrl, createDownloadUrl, verifyUpload, deleteObject, headObject } =
    await import("../src/services/storage");
  const { healthcheckKey } = await import("../src/services/storage/keys");
  const { storageContext, keyRoot } = await import("../src/services/storage/client");

  const root = keyRoot();
  const key = healthcheckKey(storageContext());
  const body = `innovatrix storage probe ${new Date().toISOString()}\n`;
  const bytes = new TextEncoder().encode(body);
  const pass = (m: string) => console.log(`  ✓ ${m}`);
  const fail = (m: string) => {
    console.log(`  ✗ ${m}`);
    process.exitCode = 1;
  };

  console.log(`bucket : ${process.env.STORAGE_BUCKET}`);
  console.log(`prefix : ${root}/`);
  console.log(`key    : ${key}\n`);

  if (!key.startsWith(`${root}/`)) return fail("key escaped our prefix");
  pass("key is inside our prefix");

  // 1. upload ticket
  const ticket = await createUploadUrl({
    scope: "healthcheck",
    key,
    filename: "probe.txt",
    contentType: "text/plain",
    sizeBytes: bytes.byteLength,
  });

  const signed = new URL(ticket.url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  console.log(`  signed headers: ${signed}`);
  signed.includes("content-type")
    ? pass("content-type IS signed (declared type is binding)")
    : fail("content-type is NOT signed — a client could upload any type");
  signed.includes("content-length")
    ? pass("content-length IS signed (exact-size enforcement)")
    : fail("content-length is NOT signed — size cap unenforceable");
  new URL(ticket.url).searchParams.has("x-amz-checksum-crc32")
    ? fail("empty-body CRC32 leaked into the URL (checksum config wrong)")
    : pass("no stray checksum query params");

  // 2. upload
  const put = await fetch(ticket.url, { method: "PUT", body: bytes, headers: ticket.headers });
  put.ok
    ? pass(`upload succeeded (${put.status})`)
    : fail(`upload failed ${put.status} ${await put.text()}`);

  // 3. size enforcement — same URL, different body length
  const wrong = await fetch(ticket.url, {
    method: "PUT",
    body: new TextEncoder().encode(body + "extra"),
    headers: ticket.headers,
  });
  wrong.ok
    ? fail("oversized body accepted — size is NOT enforced")
    : pass(`mismatched size rejected by S3 (${wrong.status})`);

  // 4. verify
  const head = await verifyUpload({
    key,
    expectedSizeBytes: bytes.byteLength,
    expectedContentType: "text/plain",
  });
  pass(`verifyUpload passed (${head.sizeBytes} bytes, ${head.contentType})`);

  // 5. unsigned fetch must be refused (§66)
  const base = process.env.STORAGE_ENDPOINT
    ? `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}`
    : `https://${process.env.STORAGE_BUCKET}.s3.${process.env.STORAGE_REGION}.amazonaws.com`;
  const anon = await fetch(`${base}/${key}`);
  anon.status === 403 || anon.status === 401
    ? pass(`unsigned fetch refused (${anon.status})`)
    : fail(`unsigned fetch returned ${anon.status} — object is publicly readable`);

  // 6. signed download + disposition
  const dl = await createDownloadUrl({
    key,
    filename: "probe report.txt",
    contentType: "text/plain",
  });
  const got = await fetch(dl.url);
  got.ok
    ? pass(`presigned GET works (${got.status})`)
    : fail(`presigned GET failed ${got.status}`);
  const cd = got.headers.get("content-disposition") ?? "";
  cd.includes("attachment")
    ? pass(`Content-Disposition honoured: ${cd}`)
    : fail(`disposition not applied: "${cd}"`);
  (await got.text()) === body
    ? pass("round-tripped content matches")
    : fail("content mismatch");

  // 7. expiry
  const short = await createDownloadUrl({ key, filename: "p.txt", expiresInSeconds: 1 });
  await new Promise((r) => setTimeout(r, 2500));
  const expired = await fetch(short.url);
  expired.ok
    ? fail("expired URL still works")
    : pass(`expired URL refused (${expired.status})`);

  // 8. cleanup — reports rather than throws, so a missing s3:DeleteObject
  //    permission surfaces as a finding instead of masking the checks above.
  try {
    await deleteObject(key);
    (await headObject(key)) === null ? pass("probe object deleted") : fail("cleanup failed");
  } catch (e) {
    const denied = String((e as { cause?: unknown }).cause ?? e).includes("s3:DeleteObject");
    console.log(
      denied
        ? `  ! s3:DeleteObject NOT PERMITTED for this key — orphan left at ${key}`
        : `  ✗ delete failed: ${e}`,
    );
    if (!denied) process.exitCode = 1;
  }

  await probeVendorDocuments({ pass, fail, root });

  console.log(`\n${process.exitCode ? "PROBE FAILED" : "probe complete — all checks passed"}`);
}

/**
 * The `vendor-document` scope — vendor ticket 02.
 *
 * Its own section because it is the most sensitive scope the platform has, and the
 * three properties that protect it are all environmental rather than logical:
 * the ownership prefix has to hold against the *bound* root, an unsigned fetch has
 * to be refused, and the object has to be deletable — which today it is not.
 *
 * It uses a `.pdf` key with a text body deliberately: `verifyUpload` is not called
 * here, so nothing sniffs it, and the point of this section is the key layout and
 * the access rules rather than the content check that `storage.test.ts` covers.
 */
async function probeVendorDocuments({
  pass,
  fail,
  root,
}: {
  pass: (m: string) => void;
  fail: (m: string) => void;
  root: string;
}) {
  const {
    createUploadUrl,
    createDownloadUrl,
    deleteObject,
    headObject,
    assertVendorDocumentKey,
  } = await import("../src/services/storage");

  const VENDOR = "652f1a2b3c4d5e6f70819200";
  const OTHER = "652f1a2b3c4d5e6f70819299";

  console.log("\nvendor-document scope");

  const { vendorDocumentKey } = await import("../src/services/storage/keys");
  const { storageContext } = await import("../src/services/storage/client");
  const key = vendorDocumentKey(storageContext(), VENDOR, "probe-id.pdf");

  key.startsWith(`${root}/vendors/${VENDOR}/documents/`)
    ? pass("key lands on the vendor's own branch")
    : fail(`key escaped the vendor branch: ${key}`);

  try {
    assertVendorDocumentKey(key, OTHER);
    fail("another vendor's id accepted this key — cross-tenant theft is open");
  } catch {
    pass("a different vendor's id is refused against this key");
  }

  const body = new TextEncoder().encode("probe\n");
  const ticket = await createUploadUrl({
    scope: "vendor-document",
    key,
    filename: "probe-id.pdf",
    contentType: "application/pdf",
    sizeBytes: body.byteLength,
  });

  const put = await fetch(ticket.url, { method: "PUT", body, headers: ticket.headers });
  put.ok ? pass(`upload succeeded (${put.status})`) : fail(`upload failed ${put.status}`);

  // §66 and §88: this is the check that matters most for this scope. An
  // unguessable URL is not protection for a passport scan, so the bucket refusing
  // an unsigned GET is the only thing standing behind the authorised route.
  const base = process.env.STORAGE_ENDPOINT
    ? `${process.env.STORAGE_ENDPOINT}/${process.env.STORAGE_BUCKET}`
    : `https://${process.env.STORAGE_BUCKET}.s3.${process.env.STORAGE_REGION}.amazonaws.com`;
  const anon = await fetch(`${base}/${key}`);
  anon.status === 403 || anon.status === 401
    ? pass(`unsigned fetch refused (${anon.status})`)
    : fail(
        `unsigned fetch returned ${anon.status} — an identity document is publicly ` +
          `readable to anyone who learns the key. Do not onboard a vendor until the ` +
          `bucket's public-read policy is removed (ticket 05).`,
      );

  const dl = await createDownloadUrl({
    key,
    filename: "probe-id.pdf",
    contentType: "application/pdf",
    expiresInSeconds: 300,
  });
  (await fetch(dl.url)).ok ? pass("presigned GET works") : fail("presigned GET failed");

  // Retention (ticket 02) depends on this, and it is currently denied. Reported
  // rather than thrown, so the finding is visible instead of masking the checks.
  try {
    await deleteObject(key);
    (await headObject(key)) === null
      ? pass("probe document deleted — retention is achievable")
      : fail("delete reported success but the object is still there");
  } catch (e) {
    const denied = String((e as { cause?: unknown }).cause ?? e).includes("s3:DeleteObject");
    console.log(
      denied
        ? `  ! s3:DeleteObject NOT PERMITTED — vendor ticket 02's retention rule cannot be ` +
            `honoured; \`purgedAt\` records intent only. Orphan left at ${key}`
        : `  ✗ delete failed: ${e}`,
    );
    if (!denied) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("\nprobe error:", e);
  process.exit(1);
});
