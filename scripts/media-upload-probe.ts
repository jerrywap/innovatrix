/**
 * The admin media upload, end to end, the way the browser does it.
 *
 * Sign → preflight → PUT → read the object back unsigned. Ticket 05 deferred
 * this path on the grounds that bucket CORS was unset; this is the check that
 * says whether that is still true, and it is the same code the admin screen
 * runs.
 */
import "dotenv/config";
import { deflateSync } from "node:zlib";

/** The smallest valid PNG: a 1×1 opaque red pixel. */
function onePixelPng(): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const head = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(head) >>> 0);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    return Buffer.concat([len, head, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.from([0x00, 0xff, 0x00, 0x00]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(buffer: Buffer): number {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc;
}

async function main() {
  const productId = process.argv[2] ?? "6a80c46f6c887b38e2f0e0c9";
  const origin = process.argv[3] ?? "http://127.0.0.1:3000";

  const storage = await import("../src/services/storage");
  const png = onePixelPng();

  const ticket = await storage.createUploadUrl({
    scope: "product-media",
    key: storage.productMediaPath(productId, "probe.png"),
    filename: "probe.png",
    contentType: "image/png",
    sizeBytes: png.byteLength,
  });

  console.log(`key            ${ticket.key}`);

  const preflight = await fetch(ticket.url, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });
  console.log(
    `preflight      HTTP ${preflight.status}  allow-origin=${preflight.headers.get("access-control-allow-origin") ?? "—"}`,
  );

  const put = await fetch(ticket.url, {
    method: "PUT",
    headers: { ...ticket.headers, Origin: origin },
    body: new Uint8Array(png),
  });
  console.log(`PUT            HTTP ${put.status}`);
  if (!put.ok) {
    console.log((await put.text()).slice(0, 300));
    process.exit(1);
  }

  const url = storage.publicObjectUrl(ticket.key);
  const read = await fetch(url);
  const body = Buffer.from(await read.arrayBuffer());
  console.log(
    `read back      HTTP ${read.status}  ${body.byteLength} bytes  ${read.headers.get("content-type")}`,
  );
  console.log(`identical      ${body.equals(png)}`);
  console.log(`\npublic url     ${url}`);

  /* The size guard: the signature pins Content-Length, so a different body must fail. */
  const wrong = await fetch(ticket.url, {
    method: "PUT",
    headers: ticket.headers,
    body: new Uint8Array(Buffer.concat([png, Buffer.from("extra")])),
  });
  console.log(`oversized PUT  HTTP ${wrong.status} (must not be 200)`);

  /*
   * Replacement must overwrite, not orphan.
   *
   * Uploading over an image reuses its key, so this signs a second PUT for the
   * *same* key with different bytes and checks that reading it back gives the
   * new ones. If this ever starts minting a fresh key, a corrected screenshot
   * silently leaves the wrong one behind — and with `s3:DeleteObject` denied,
   * behind is where it stays.
   */
  const replacement = Buffer.concat([png, Buffer.from("\n")]);
  const second = await storage.createUploadUrl({
    scope: "product-media",
    key: storage.assertProductMediaKey(ticket.key, productId),
    filename: "probe.png",
    contentType: "image/png",
    sizeBytes: replacement.byteLength,
  });

  console.log(`\nreplace: same key   ${second.key === ticket.key}`);
  const overwrite = await fetch(second.url, {
    method: "PUT",
    headers: second.headers,
    body: new Uint8Array(replacement),
  });
  const after = Buffer.from(
    await (await fetch(storage.publicObjectUrl(second.key))).arrayBuffer(),
  );
  console.log(`         PUT        HTTP ${overwrite.status}`);
  console.log(
    `         overwritten ${after.equals(replacement)} (was ${png.byteLength}b, now ${after.byteLength}b)`,
  );

  /* A key belonging to a different product must be refused outright. */
  try {
    storage.assertProductMediaKey(ticket.key, "6a80c46f6c887b38e2f0e0b9");
    console.log(`         cross-product key ACCEPTED — that is a hole`);
  } catch {
    console.log(`         cross-product key refused`);
  }

  /*
   * Ticket 05's other blocker. Still denied at the time of writing, which is
   * why *deleting* a screenshot row leaves the object behind — checked here
   * rather than asserted in a comment that nobody re-runs.
   */
  try {
    await storage.deleteObject(ticket.key);
    console.log(`\ndelete         permitted — s3:DeleteObject is no longer denied`);
  } catch {
    console.log(`\ndelete         DENIED — removing a row orphans (ticket 05 blocker 2)`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
