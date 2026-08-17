import "server-only";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { ValidationError } from "@/lib/errors";

/**
 * Fetching bytes from a URL a **third party** chose — vendor ticket 06.
 *
 * This is the machinery the mirror and repository delivery methods share and the
 * archive method needs none of. It exists because "download this URL" written naively
 * is a server-side request forgery primitive: the caller picks the address and our
 * process has network positions nobody outside does.
 *
 * ## What it refuses, and why each one matters
 *
 * - **Anything but `https:`.** `http:` is a downgrade a vendor cannot consent to on a
 *   customer's behalf, and `file:`, `ftp:`, `gopher:` and `data:` are not transports —
 *   they are ways to read the disk or confuse a parser.
 * - **Private, loopback, link-local and unique-local addresses**, resolved by DNS
 *   rather than judged by the hostname. `169.254.169.254` is a cloud metadata endpoint
 *   holding instance credentials; `10.0.0.0/8` is the rest of our own infrastructure.
 *   Checking the *string* is the mistake: `metadata.example.com` can resolve to
 *   `169.254.169.254`, which is why this resolves first and checks the answer.
 * - **A redirect that leaves the declared host.** `manual` redirect handling, one
 *   `Location` at a time, each re-validated. Following redirects with `redirect:
 *   "follow"` hands the allowlist decision to whoever controls the first response.
 * - **More bytes than the cap**, counted **as they arrive** and aborted mid-stream. A
 *   `Content-Length` header is a claim; the only number that matters is what has
 *   actually been read.
 *
 * ## What it does not do
 *
 * It does not decide whether the bytes are acceptable — that is `verifyUpload()`'s
 * magic-byte sniff and the storage policy, applied identically to an uploaded archive.
 * This function's whole job is getting bytes into memory safely and telling the truth
 * about what it got.
 *
 * ## The DNS race this does not close
 *
 * Between the lookup here and the connection the runtime makes, a hostile DNS server
 * can answer differently — a classic rebind. Closing it properly means connecting to
 * the validated IP with the original `Host` header, which `fetch` cannot express. The
 * gap is narrow, the fetch runs in a job rather than a request, and the honest position
 * is to name it rather than imply the check is complete. Pinning belongs with an
 * undici `Agent` and a `connect` hook if this ever guards something more valuable than
 * a build artefact.
 */

/** Aborted this far in rather than trusting `Content-Length`. */
export const MAX_FETCH_BYTES = 2 * 1024 * 1024 * 1024;

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 10 * 60_000;

export interface FetchedArtefact {
  bytes: Uint8Array;
  contentType: string;
  /** Hex SHA-256 of exactly the bytes above. */
  sha256: string;
  /** The URL the bytes actually came from, after any redirects. */
  finalUrl: string;
}

export class RemoteFetchError extends ValidationError {}

/**
 * Fetch a remote artefact, or refuse.
 *
 * `maxBytes` is a cap, never a suggestion: the read loop stops and the request is
 * aborted the moment it is exceeded, so a hostile endpoint streaming forever costs one
 * cap's worth of memory rather than the process.
 */
export async function fetchRemoteArtefact(
  rawUrl: string,
  options: {
    maxBytes?: number;
    expectedSha256?: string;
    /**
     * A bearer token for a private repository.
     *
     * Sent as a header, never in the URL — `assertFetchable` refuses URL credentials
     * for exactly this reason: a URL ends up in logs, in an audit row and in an error
     * message, and a header does not. Dropped on a cross-host redirect along with
     * everything else, because the redirect is refused outright.
     */
    token?: string;
  } = {},
): Promise<FetchedArtefact> {
  const maxBytes = Math.min(options.maxBytes ?? MAX_FETCH_BYTES, MAX_FETCH_BYTES);

  let url = await assertFetchable(rawUrl);
  const originalHost = url.hostname;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let response: Response | undefined;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "*/*",
          ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        },
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = response.headers.get("location");
      if (!location) {
        throw new RemoteFetchError("That URL redirected without saying where to.", {
          url: ["The server sent a redirect with no destination."],
        });
      }

      const next = await assertFetchable(new URL(location, url).toString());

      /*
       * A redirect that leaves the declared host is refused rather than followed.
       *
       * The vendor told us which host serves their artefact, and that is the statement
       * we are checking a digest against. A redirect elsewhere may be perfectly
       * innocent — a CDN, a bucket — but it is also exactly how an open redirect on a
       * trusted host turns into a fetch of something else, and we cannot tell the two
       * apart. If a vendor needs the CDN, they can name the CDN.
       */
      if (next.hostname !== originalHost) {
        throw new RemoteFetchError(
          `That URL redirects to ${next.hostname}, which is not the host you gave us. ` +
            `Use the address the file is actually served from.`,
          { url: ["A redirect must stay on the same host."] },
        );
      }

      url = next;
      response = undefined;
    }

    if (!response) {
      throw new RemoteFetchError("That URL redirected too many times.", {
        url: [`More than ${MAX_REDIRECTS} redirects.`],
      });
    }

    if (!response.ok) {
      throw new RemoteFetchError(`That URL answered ${response.status}.`, {
        url: [`Expected a 200; got ${response.status}.`],
      });
    }

    const bytes = await readCapped(response, maxBytes, controller);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (options.expectedSha256 && options.expectedSha256.toLowerCase() !== sha256) {
      /*
       * The digest is the vendor's declaration about what should be there, and this is
       * the check that makes "vendor-hosted" trustworthy at all: without it, whatever
       * is at that URL *today* becomes what customers download, and the vendor's own
       * server is the one place we have no control over.
       *
       * The message gives both digests because the usual cause is a rebuild the vendor
       * forgot to re-declare, and they need to see that it is not corruption.
       */
      throw new RemoteFetchError(
        "What is at that URL does not match the checksum you gave us, so we have not " +
          "stored it. If you rebuilt the package, update the checksum.",
        {
          checksumSha256: [
            `Declared ${options.expectedSha256.toLowerCase()}, found ${sha256}.`,
          ],
        },
      );
    }

    return {
      bytes,
      contentType:
        response.headers.get("content-type")?.split(";")[0]?.trim() ??
        "application/octet-stream",
      sha256,
      finalUrl: url.toString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Read the body, counting as we go, and abort the moment the cap is passed.
 *
 * `response.arrayBuffer()` would be one line and would buffer whatever the endpoint
 * sends before we could object — which is the whole attack. `Content-Length` is not
 * consulted for the decision: it is a claim, and a chunked response has none.
 */
async function readCapped(
  response: Response,
  maxBytes: number,
  controller: AbortController,
): Promise<Uint8Array> {
  const body = response.body;
  if (!body) {
    throw new RemoteFetchError("That URL returned no content.", { url: ["Empty response."] });
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = body.getReader();

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    total += value.byteLength;
    if (total > maxBytes) {
      controller.abort();
      throw new RemoteFetchError(
        `That file is larger than the ${Math.round(maxBytes / (1024 * 1024))}MB limit.`,
        { url: ["Too large. Nothing was stored."] },
      );
    }
    chunks.push(value);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Parse and validate a URL, resolving DNS and rejecting every address we must not
 * reach.
 *
 * Exported so the *form* can refuse a bad URL when a vendor types it, rather than at
 * release time when a job fails — the same function, so the two answers cannot differ.
 */
export async function assertFetchable(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new RemoteFetchError("That is not a URL.", { url: ["Include https:// and a host."] });
  }

  if (url.protocol !== "https:") {
    throw new RemoteFetchError("Only https addresses are accepted.", {
      url: ["Use https. An http download can be tampered with in transit."],
    });
  }

  // Credentials in a URL end up in logs and in the audit trail. If a repository needs
  // a token it is sealed and sent as a header — see `pullRepositoryTarball`.
  if (url.username || url.password) {
    throw new RemoteFetchError("Do not put credentials in the URL.", {
      url: ["Use the token field instead."],
    });
  }

  for (const address of await resolveAll(url.hostname)) {
    if (isForbiddenAddress(address)) {
      throw new RemoteFetchError(
        `That host resolves to ${address}, which is a private or internal address.`,
        { url: ["Point this at a publicly reachable address."] },
      );
    }
  }

  return url;
}

/** Every address the host resolves to. A literal IP is its own answer. */
async function resolveAll(hostname: string): Promise<string[]> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) return [bare];

  try {
    const answers = await lookup(hostname, { all: true, verbatim: true });
    if (answers.length === 0) {
      throw new RemoteFetchError("That host does not resolve.", { url: ["Unknown host."] });
    }
    return answers.map((answer) => answer.address);
  } catch (error) {
    if (error instanceof RemoteFetchError) throw error;
    throw new RemoteFetchError("That host does not resolve.", { url: ["Unknown host."] });
  }
}

/**
 * The address ranges this process must never be pointed at.
 *
 * `169.254.169.254` is called out on its own line rather than left to the
 * `169.254.0.0/16` rule it falls under, because it is the reason this function exists:
 * on most cloud providers it serves instance credentials to anything that asks.
 */
export function isForbiddenAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isForbiddenIpv4(address);
  if (version === 6) return isForbiddenIpv6(address);
  // Neither — treat as forbidden rather than guessing.
  return true;
}

function isForbiddenIpv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255))
    return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 and 192.0.2.0/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

function isForbiddenIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === "::" || lower === "::1") return true; // unspecified, loopback
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return true; // link-local
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
  if (lower.startsWith("ff")) return true; // multicast

  // An IPv4-mapped address (`::ffff:10.0.0.1`) is an IPv4 address wearing a hat, and
  // judging it as v6 would wave every private range straight through.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped?.[1]) return isForbiddenIpv4(mapped[1]);

  return false;
}
