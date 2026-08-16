import { z } from "zod";
import { activateLicence, deactivateLicence } from "@/services/entitlements/activation-service";
import { LIMITS, callerIp, consume, tooManyRequests } from "@/lib/rate-limit";

/**
 * `POST /api/licences/activate` — §65.
 *
 * ## Authenticated by the licence key, and nothing else
 *
 * The caller is installed software on somebody's own server. There is no
 * session, no cookie and no origin worth checking — which is why the key is 75
 * bits of CSPRNG with a checksum, and why this endpoint does the absolute
 * minimum: it claims a slot and reports the licence's terms.
 *
 * `proxy.ts` does not exclude `/api/licences`, and does not need to: the proxy
 * only redirects `/dashboard`, `/staff` and `/admin`, so this passes through
 * untouched.
 *
 * ## Documented shape, because products integrate against it
 *
 * ```
 * POST { key, instanceId, domain? }
 *   200 { valid: true,  expiresAt?, supportExpiresAt?, supportActive,
 *         activationsUsed, activationLimit }
 *   200 { valid: false, refusal, message, activationsUsed?, activationLimit? }
 * ```
 *
 * A refusal is **200 with `valid: false`**, not 4xx. An installer checking a
 * licence is asking a question, and the answer "no, and here is why" is a
 * successful response — a 403 makes every HTTP client treat a legitimate
 * "limit reached" as a transport failure to retry.
 *
 * ## Rate limited by IP — ticket 26
 *
 * The **one** consequence of the key being the only credential: this is the
 * only endpoint in the app where somebody can guess at a secret as fast as they
 * can send requests. The key is 75 bits with a checksum, so guessing is not a
 * realistic attack on any timescale — but "not realistic" is an argument about
 * arithmetic, and an unbounded endpoint is also a way to make this server do
 * database work on demand.
 *
 * Keyed on the caller's IP rather than the key: keying on the key would let an
 * attacker cycle through candidates for free, which is precisely backwards.
 *
 * A 429 here **is** a transport failure, unlike a refusal, so it is a real 429
 * with a `Retry-After` rather than a `valid: false`.
 */

const activateSchema = z
  .object({
    key: z.string().trim().min(1).max(60),
    /**
     * Whatever the product uses to identify one installation — a machine id, a
     * container id, a site url. Opaque to us; we only compare it.
     */
    instanceId: z.string().trim().min(1).max(200),
    domain: z.string().trim().max(253).optional(),
    // `.strict()` — ticket 26. Zod's default *strips* an unknown key, which is
    // safe but silent. On a public integration endpoint an unexpected field is a
    // signal: a product sending `licenseKey` instead of `key`, or a caller
    // probing for undocumented parameters. Refusing says so at the boundary
    // instead of returning "invalid_format" for a field that was actually there.
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  // Before the body is read, so a flood costs us a parse we did not have to do.
  const budget = await consume(LIMITS.licenceActivation, callerIp(request));
  if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ valid: false, refusal: "invalid_format", message: "Expected JSON." }, 400);
  }

  const parsed = activateSchema.safeParse(body);
  if (!parsed.success) {
    return json(
      {
        valid: false,
        refusal: "invalid_format",
        message: "A key and an instanceId are required.",
      },
      400,
    );
  }

  const result = await activateLicence(parsed.data);
  return json(result, 200);
}

/**
 * `DELETE` releases the slot, so moving an installation is one endpoint rather
 * than two — the same key, the same instance id, the opposite verb.
 */
export async function DELETE(request: Request): Promise<Response> {
  // Same budget as activation: releasing a slot is as good an oracle as taking
  // one, because both tell you whether the key exists.
  const budget = await consume(LIMITS.licenceActivation, callerIp(request));
  if (!budget.allowed) return tooManyRequests(budget.retryAfterSeconds);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ valid: false, refusal: "invalid_format", message: "Expected JSON." }, 400);
  }

  const parsed = activateSchema.omit({ domain: true }).safeParse(body);
  if (!parsed.success) {
    return json(
      {
        valid: false,
        refusal: "invalid_format",
        message: "A key and an instanceId are required.",
      },
      400,
    );
  }

  return json(await deactivateLicence(parsed.data), 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
