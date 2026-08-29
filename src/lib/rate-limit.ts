import "server-only";
import { createHash } from "node:crypto";
import { Schema, type Types } from "mongoose";
import { connectToDatabase, defineModel } from "@/lib/db/client";
import { schemaOptions } from "@/lib/db/base";
import { RateLimitError } from "@/lib/errors";

/**
 * Rate limiting — §88, ticket 26.
 *
 * ## Why Mongo and not Redis
 *
 * The same reasoning as the job queue: one datastore, no new infrastructure in
 * every environment including CI, and the volumes involved are login attempts
 * and licence activations rather than page views. A fixed window over an
 * indexed collection with a TTL is a `findOneAndUpdate` per check.
 *
 * The honest cost is that this is **not distributed-atomic across a burst** in
 * the way a Redis `INCR` is — but it is atomic per document, which is the same
 * thing for one key. What it does not do is coordinate a global budget, and
 * nothing here needs one.
 *
 * ## A fixed window, not a sliding one, and the consequence
 *
 * A fixed window lets through up to 2× the limit across a window boundary: five
 * at 11:59:59 and five at 12:00:00. A sliding log would fix that and would cost
 * a document per attempt. For "five login attempts a minute" the boundary case
 * is ten in two seconds, which is still not a brute force.
 *
 * ## Fails **open**, deliberately, and this is the one to argue with
 *
 * If the database is unreachable the limiter allows the request. The
 * alternative is that a Mongo blip locks every customer out of signing in,
 * which is a worse outage than a window of unthrottled attempts — and every
 * endpoint behind this limiter has a real authorisation check after it. A
 * limiter is a cost and abuse control, never the thing standing between an
 * attacker and the data.
 */

interface RateLimitDoc {
  _id: Types.ObjectId;
  /** `bucket:hashedIdentity:windowStart`. */
  key: string;
  count: number;
  /** When this window's row may be swept. */
  expiresAt: Date;
}

const rateLimitSchema = new Schema<RateLimitDoc>(
  {
    key: { type: String, required: true },
    count: { type: Number, required: true, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  schemaOptions({ collection: "rateLimits" }),
);

/** One row per key per window; the upsert races on this index rather than a read. */
rateLimitSchema.index({ key: 1 }, { unique: true });

/** Mongo sweeps expired windows, so nothing here has to. */
rateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RateLimit = defineModel<RateLimitDoc>("RateLimit", rateLimitSchema);

export interface LimitRule {
  /** Names the bucket, and appears in no response. */
  readonly name: string;
  readonly limit: number;
  readonly windowSeconds: number;
}

/**
 * §88's table, as data.
 *
 * Written down in one place so "what is throttled and how hard" is a question
 * with an answer, rather than eight numbers spread across eight files.
 */
export const LIMITS = {
  /** Credential stuffing is the threat; a human types their password twice. */
  login: { name: "login", limit: 10, windowSeconds: 300 },
  register: { name: "register", limit: 5, windowSeconds: 3600 },
  passwordReset: { name: "password-reset", limit: 5, windowSeconds: 3600 },
  /**
   * Changing a password, adding one, or connecting and disconnecting a provider.
   *
   * Every one of these sends an email to the account holder, which is the same
   * property that earns `passwordReset` its limit — and unlike that one, these
   * are authenticated, so the identity is a user id rather than an address.
   * Better Auth's own `customRules` cover `/sign-in` and `/request-password-reset`
   * but none of these paths; they fall back to its blanket 60-per-minute, which
   * is a lot of security emails.
   *
   * Ten an hour is generous for a human and cheap to hit deliberately.
   */
  accountSecurity: { name: "account-security", limit: 10, windowSeconds: 3600 },
  /** §65. The key *is* the credential, so this is the brute-force surface. */
  licenceActivation: { name: "licence-activation", limit: 20, windowSeconds: 3600 },
  /** Cost protection, not abuse protection — a turn is an AI call we pay for. */
  aiTurn: { name: "ai-turn", limit: 60, windowSeconds: 3600 },
  /**
   * Drafting the brief. Tighter than a turn, because it costs more and is
   * *repeatable on one button* — "Review and submit" re-extracts the whole
   * transcript at up to the full output allowance, with an automatic retry on a
   * second strategy if the first parse fails. A customer legitimately redrafts
   * two or three times after editing; ten in an hour is a stuck finger or a
   * script, and either way we are paying for it.
   */
  aiExtract: { name: "ai-extract", limit: 10, windowSeconds: 3600 },
  /**
   * Authoring help in the product wizard — "Enhance summary", "Enhance
   * description", "Generate features".
   *
   * Higher than `aiExtract` because it is pressed *while writing*, and a vendor
   * working through a listing will legitimately use it on three fields across
   * several products in a sitting. Lower than `aiTurn` because each press is a
   * whole rewrite rather than one conversational reply, and because — unlike a
   * turn — nothing is lost by refusing: the author types it themselves.
   */
  aiAuthor: { name: "ai-author", limit: 30, windowSeconds: 3600 },
  download: { name: "download", limit: 100, windowSeconds: 86_400 },
  /** §46: revealing a demo credential is exactly the thing to scrape. */
  demoReveal: { name: "demo-reveal", limit: 20, windowSeconds: 3600 },
  /** Generous but bounded — a provider retrying is normal (§87). */
  webhook: { name: "webhook", limit: 600, windowSeconds: 60 },
  search: { name: "search", limit: 300, windowSeconds: 60 },
  /**
   * Vendor ticket 03. Sends an email to an address the caller chose, which is the
   * same property that earns `passwordReset` its limit. A real vendor invites a
   * colleague or two; twenty in an hour is somebody using us as a mailer.
   */
  vendorInvite: { name: "vendor-invite", limit: 20, windowSeconds: 3600 },
} as const satisfies Record<string, LimitRule>;

export interface LimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Count one attempt against a rule.
 *
 * `identity` is whatever distinguishes callers for this rule — a user id, an IP,
 * an email address. It is **hashed** before storage: an unhashed collection of
 * "who tried to sign in as whom" is a small database of email addresses and
 * source IPs with a TTL, which is not something to keep by accident.
 */
export async function consume(rule: LimitRule, identity: string): Promise<LimitResult> {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const windowStart = Math.floor(now / windowMs);
  const expiresAt = new Date((windowStart + 1) * windowMs);
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - now) / 1000));

  const key = `${rule.name}:${fingerprint(identity)}:${windowStart}`;

  try {
    await connectToDatabase();

    /*
     * Upsert-and-increment in one operation.
     *
     * A read-then-write would let ten concurrent attempts all see a count of
     * zero — which is the exact burst the limiter exists to stop, so getting
     * this wrong would produce a limiter that only works when it is not needed.
     */
    const row = await RateLimit.findOneAndUpdate(
      { key },
      { $inc: { count: 1 }, $setOnInsert: { expiresAt } },
      { upsert: true, returnDocument: "after" },
    ).lean<{ count: number }>();

    const count = row?.count ?? 1;

    return {
      allowed: count <= rule.limit,
      remaining: Math.max(0, rule.limit - count),
      retryAfterSeconds,
    };
  } catch (error) {
    // Fail open — see the note at the top. Logged loudly, because a limiter
    // that is quietly not limiting should not be quiet.
    console.error(`[rate-limit] ${rule.name} check failed, allowing:`, error);
    return { allowed: true, remaining: rule.limit, retryAfterSeconds };
  }
}

/** Consume, and throw `RateLimitError` when the budget is spent. */
export async function enforce(rule: LimitRule, identity: string): Promise<void> {
  const result = await consume(rule, identity);
  if (!result.allowed) throw new RateLimitError(result.retryAfterSeconds);
}

/**
 * The caller's IP, for rules that have no user to key on.
 *
 * Reads the proxy headers because the app sits behind one in every deployment
 * that matters. That is trusted input — a client can send `x-forwarded-for`
 * itself — so it is **only ever used as a rate-limit key**, never for
 * authorisation, and the worst a forged one achieves is spending somebody
 * else's budget or dodging its own. The fallback groups everyone together,
 * which throttles hard rather than not at all.
 */
export function callerIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}

/**
 * A stable, non-reversible handle for an identity.
 *
 * Truncated to 160 bits, which is far past collision territory for this and
 * keeps the index small.
 */
function fingerprint(identity: string): string {
  return createHash("sha256").update(identity).digest("hex").slice(0, 40);
}

/** A 429 with the headers a well-behaved client acts on. */
export function tooManyRequests(retryAfterSeconds: number): Response {
  return Response.json(
    // No counts, no window, no rule name. A limiter that explains itself tells
    // an attacker how to pace.
    { error: "Too many requests." },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}
