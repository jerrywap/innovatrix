import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import { Licence, type LicenceDoc } from "@/lib/db/models/commerce";
import { isValidLicenceKeyFormat, normaliseLicenceKey } from "@/lib/licence-key";
import { licences } from "@/repositories/entitlement.repository";
import { entitlements } from "@/repositories/entitlement.repository";
import { hasSupport } from "./rules";

/**
 * Licence activation — §65, ticket 14.
 *
 * ## The seam products integrate with
 *
 * Installed software calls this with a key and an instance id. It is the one
 * public endpoint authenticated by **the licence key itself**, which is why
 * that key is 75 bits of CSPRNG with a checksum rather than something
 * sequential.
 *
 * Kept deliberately small: a licence server that grows features is a licence
 * server that goes down and takes every customer's installation with it.
 *
 * ## Activating twice from the same instance is not a second activation
 *
 * A reinstall, a container restart, a redeploy — all of these call activate
 * again with the same `instanceId`. Counting each as a new one would exhaust a
 * three-installation licence in a week of ordinary deployments, and the
 * customer would experience it as the licence "wearing out".
 */

export type ActivationRefusal =
  "invalid_format" | "not_found" | "licence_suspended" | "licence_expired" | "limit_reached";

export interface ActivationResult {
  valid: boolean;
  refusal?: ActivationRefusal;
  message?: string;
  expiresAt?: string;
  supportExpiresAt?: string;
  supportActive?: boolean;
  activationsUsed?: number;
  activationLimit?: number;
}

const MESSAGES: Record<ActivationRefusal, string> = {
  invalid_format: "That doesn't look like a licence key — check it for typos.",
  not_found: "We don't recognise that licence key.",
  licence_suspended: "This licence is suspended. Get in touch and we'll help.",
  licence_expired: "This licence has expired.",
  limit_reached: "This licence is already active on the maximum number of installations.",
};

export async function activateLicence(input: {
  key: string;
  instanceId: string;
  domain?: string;
}): Promise<ActivationResult> {
  // Checked before any query, so a typo costs no database round trip — and a
  // key-guessing script gets no timing difference between "malformed" and
  // "not found".
  if (!isValidLicenceKeyFormat(input.key)) return refuse("invalid_format");

  await connectToDatabase();

  const key = normaliseLicenceKey(input.key);
  const licence = await licences.findByKey(key);
  if (!licence) return refuse("not_found");

  if (licence.status === "suspended" || licence.status === "revoked") {
    return refuse("licence_suspended");
  }
  if (licence.expiresAt && licence.expiresAt < new Date()) return refuse("licence_expired");

  const live = licence.activations.filter((activation) => !activation.releasedAt);
  const already = live.find((activation) => activation.instanceId === input.instanceId);

  if (already) {
    // Idempotent. A reinstall is not a new installation.
    return success(licence, live.length);
  }

  if (live.length >= licence.activationLimit) {
    return {
      ...refuse("limit_reached"),
      activationsUsed: live.length,
      activationLimit: licence.activationLimit,
    };
  }

  /*
   * The guard is in the filter, not in an `if` above it.
   *
   * Two servers booting together both read `live.length === 2` against a
   * three-installation licence and both write — four activations on a
   * three-seat licence, and nobody notices until an audit. `$expr` counts the
   * live activations inside the update, so the database decides.
   */
  const claimed = await Licence.findOneAndUpdate(
    {
      _id: licence._id,
      status: "active",
      $expr: {
        $lt: [
          {
            $size: {
              $filter: {
                input: "$activations",
                as: "activation",
                cond: { $not: [{ $ifNull: ["$$activation.releasedAt", false] }] },
              },
            },
          },
          "$activationLimit",
        ],
      },
    },
    {
      $push: {
        activations: {
          instanceId: input.instanceId,
          ...(input.domain ? { domain: input.domain } : {}),
          activatedAt: new Date(),
        },
      },
    },
    { returnDocument: "after" },
  ).lean<LicenceDoc>();

  if (!claimed) {
    return {
      ...refuse("limit_reached"),
      activationsUsed: live.length,
      activationLimit: licence.activationLimit,
    };
  }

  return success(claimed, claimed.activations.filter((a) => !a.releasedAt).length);
}

/**
 * Release an installation, freeing a slot.
 *
 * Stamps `releasedAt` rather than removing the entry: "this licence has been
 * installed four times and two are live" is a support question, and a released
 * activation that leaves no trace makes it unanswerable.
 */
export async function deactivateLicence(input: {
  key: string;
  instanceId: string;
}): Promise<ActivationResult> {
  if (!isValidLicenceKeyFormat(input.key)) return refuse("invalid_format");

  await connectToDatabase();

  const key = normaliseLicenceKey(input.key);
  const licence = await licences.findByKey(key);
  if (!licence) return refuse("not_found");

  const updated = await Licence.findOneAndUpdate(
    { _id: licence._id },
    { $set: { "activations.$[target].releasedAt": new Date() } },
    {
      arrayFilters: [
        { "target.instanceId": input.instanceId, "target.releasedAt": { $exists: false } },
      ],
      returnDocument: "after",
    },
  ).lean<LicenceDoc>();

  const live = (updated ?? licence).activations.filter((a) => !a.releasedAt);
  return success(updated ?? licence, live.length);
}

/*
 * There was a `checkLicence(key)` here — a read-only verify that claimed no
 * slot. Removed: ticket 14 specifies two operations, activate and release, and
 * nothing ever called the third. An exported function with no caller and no
 * route reads as API surface that products can integrate against, which this
 * was not. Worth having the day something needs it; not worth pretending to
 * have until then.
 */

/**
 * Which entitlement a key belongs to — for the customer's own licence page.
 *
 * Org-scoped by the caller, never by the key: the key alone is enough to
 * *activate*, and deliberately not enough to read somebody's purchase history.
 */
export async function licenceForEntitlement(
  entitlementId: string,
  organizationId: string,
): Promise<LicenceDoc | null> {
  await connectToDatabase();

  const entitlement = await entitlements.findByIdForOrganization(entitlementId, organizationId);
  if (!entitlement) return null;

  return licences.findByEntitlement(entitlementId);
}

function success(licence: LicenceDoc, activationsUsed: number): ActivationResult {
  return {
    valid: true,
    ...(licence.expiresAt ? { expiresAt: licence.expiresAt.toISOString() } : {}),
    ...(licence.supportExpiresAt
      ? { supportExpiresAt: licence.supportExpiresAt.toISOString() }
      : {}),
    supportActive: hasSupport(licence.supportExpiresAt),
    activationsUsed,
    activationLimit: licence.activationLimit,
  };
}

function refuse(refusal: ActivationRefusal): ActivationResult {
  return { valid: false, refusal, message: MESSAGES[refusal] };
}

export { MESSAGES as ACTIVATION_MESSAGES };
