import "server-only";
import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/config/env";

/**
 * The shared guard for every `/api/cron/*` route.
 *
 * Extracted when the second cron route arrived, because the interesting part is
 * the **refusal posture** and two copies of it would eventually disagree:
 *
 * - **Unset secret ⇒ 503, not "allow".** An unauthenticated reconciliation
 *   endpoint is a way to make this server call three payment providers on
 *   demand. Failing closed means a misconfigured deployment stops doing
 *   background work, which is visible; failing open means it does that work for
 *   anyone who finds the URL, which is not.
 * - **Constant-time compare.** A `===` on a secret leaks its length and then
 *   its prefix to anyone willing to time the responses.
 * - **Both header shapes.** Vercel Cron sends `Authorization: Bearer`; most
 *   other schedulers are easier to configure with a plain header.
 *
 * Returns a `Response` to send, or `null` when the caller may proceed.
 */
export function assertCronSecret(request: Request): Response | null {
  const secret = serverEnv().CRON_SECRET;

  if (!secret) {
    return Response.json(
      { error: "Scheduled work is not configured (CRON_SECRET)." },
      { status: 503 },
    );
  }

  const provided = request.headers.get("x-cron-secret") ?? bearer(request);
  if (!provided || !safeEqual(provided, secret)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  return null;
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  // `timingSafeEqual` throws on a length mismatch, so this has to be checked
  // first — and checking it is not a leak worth closing: the length of a
  // 64-hex-character secret is not the secret.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
