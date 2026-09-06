/**
 * Ticket 31's `## Live verification`, driven against real hosts.
 *
 * The probe is `fetch`, a redirect walk and a timeout. A unit test of it would
 * be a unit test of `fetch` — what is worth knowing is whether it reaches the
 * right verdict about servers nobody here controls, which only a real request
 * can answer. `frameability.test.ts` covers the two pure functions underneath.
 *
 * `probeFrameability` rather than `frameability`: the cached wrapper is a
 * `use cache` function and throws outside a Next request.
 *
 *   npm run frame:probe                       # the standing cases
 *   npm run frame:probe https://example.com   # one URL
 */
import { probeFrameability } from "../src/services/marketplace/frameability";
import { isPubliclyRoutable } from "../src/services/marketplace/frameability";

/** [url, what we expect, why it is in the list] */
const CASES: ReadonlyArray<[string, string, string]> = [
  ["https://cosetup.net/", "blocked", "our own site — frame-ancestors 'none' from ticket 26"],
  ["https://www.google.com/", "blocked", "sends X-Frame-Options: SAMEORIGIN"],
  ["https://github.com/", "blocked", "frame-ancestors 'none'"],
  ["https://example.com/", "allowed", "a plain page with neither header"],
  [
    "https://iana.org/",
    "blocked",
    "301 with no headers -> www, which sends DENY. The redirect case that opened the ticket:" +
      " judging the 302 instead of where it lands would call this frameable",
  ],
  [
    "https://neverssl.com/",
    "unknown",
    "no https listener at all, so the connection hangs — the 3s deadline, and fail-open",
  ],
  ["https://127.0.0.1/", "unknown", "SSRF guard: loopback, refused before any request"],
  ["https://169.254.169.254/", "unknown", "SSRF guard: the cloud metadata endpoint"],
  ["https://this-host-does-not-exist-31.invalid/", "unknown", "DNS failure is not a verdict"],
];

async function main(): Promise<void> {
  const argument = process.argv[2];
  const cases: ReadonlyArray<[string, string, string]> = argument
    ? [[argument, "?", "from the command line"]]
    : CASES;

  console.log("frameability probe\n");

  let wrong = 0;
  for (const [url, expected, why] of cases) {
    const started = Date.now();
    const verdict = await probeFrameability(url);
    const took = Date.now() - started;

    const mark = expected === "?" ? " " : verdict === expected ? "✓" : "✗";
    if (mark === "✗") wrong += 1;

    console.log(
      `${mark} ${verdict.padEnd(8)} ${String(took).padStart(5)}ms  ${url}\n` +
        `             ${why}${expected === "?" || verdict === expected ? "" : `  — expected ${expected}`}`,
    );
  }

  // The address predicate, spot-checked against the list the unit tests assert
  // in full, so this script's output stands alone as evidence.
  const addresses = ["93.184.216.34", "10.0.0.1", "169.254.169.254", "::ffff:127.0.0.1"];
  console.log(
    `\nisPubliclyRoutable  ${addresses
      .map((address) => `${address}=${isPubliclyRoutable(address)}`)
      .join("  ")}`,
  );

  if (wrong > 0) {
    console.error(`\n${wrong} case(s) did not match. A third party may have changed a header.`);
    process.exitCode = 1;
  }
}

void main();
