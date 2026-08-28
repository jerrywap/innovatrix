import "server-only";
import { connectToDatabase } from "@/lib/db/client";
import { StorefrontSettings, type StorefrontSettingsDoc } from "@/lib/db/models/vendors";
import {
  STOREFRONT_FIELDS,
  STOREFRONT_FIELDS_SHOWN_BY_DEFAULT,
  type StorefrontField,
} from "@/config/storefront";

/**
 * What a vendor storefront is allowed to show.
 *
 * ## Why this exists
 *
 * A vendor's website URL is validated as a URL and published — there is no
 * approval queue for profile changes, so the only lever staff had over a link
 * being abused was `vendor.suspend`, which unlists the vendor's entire
 * catalogue. That is a sledgehammer for a hyperlink. This is the control in
 * between.
 *
 * ## Two levels, most specific wins
 *
 * ```
 * shown by default  →  platform setting  →  vendor override
 * ```
 *
 * Deliberately the same shape as `resolveCommission`, and for the same reason:
 * the platform-wide answer is the one that changes during an incident, and the
 * per-vendor answer is the one that has to survive it. Turning `website` off
 * platform-wide while one trusted vendor's override says `true` is not an edge
 * case — it is the case both levels exist for.
 *
 * ## Absence is a state, not a default
 *
 * At both levels a missing key means "nobody has decided", which is why neither
 * schema declares a Mongoose `default`. A boolean that defaulted to `true` on
 * first write would silently promote every unconsidered field to a deliberate
 * decision, and the platform level would then never be consulted again for that
 * vendor.
 *
 * The base is `STOREFRONT_FIELDS_SHOWN_BY_DEFAULT`, so an empty settings
 * collection and a vendor with no overrides render exactly the storefront that
 * existed before any of this — no migration, no seed, and no deploy in which
 * every vendor's website link disappears.
 */

/** Every field, resolved. Complete by construction, so a caller cannot forget one. */
export type StorefrontVisibility = Readonly<Record<StorefrontField, boolean>>;

/** Where an answer came from — the staff screen says so rather than making staff guess. */
export type VisibilitySource = "default" | "platform" | "vendor";

/**
 * The platform-wide row, or an empty object.
 *
 * Empty rather than a populated default, because the caller distinguishes "not
 * set" from "set to true" and a filled-in object would destroy that.
 */
export async function platformStorefrontDefaults(): Promise<
  Partial<Record<StorefrontField, boolean>>
> {
  await connectToDatabase();

  const row = await StorefrontSettings.findOne({ singleton: "global" })
    .select({ fields: 1 })
    .lean<Pick<StorefrontSettingsDoc, "fields">>();

  return row?.fields ?? {};
}

/**
 * Resolve one vendor against the platform defaults.
 *
 * Pure, and takes both levels as arguments rather than reading either: the
 * public storefront resolves inside a `"use cache"` scope and the vendor's own
 * preview resolves uncached from a document it already holds, so the read
 * belongs to the caller. It is also what makes the rule unit-testable without a
 * database, which for a rule about who sees what is worth the parameter.
 */
export function resolveStorefrontVisibility(
  vendor:
    { storefrontVisibility?: Partial<Record<StorefrontField, boolean>> } | null | undefined,
  platform: Partial<Record<StorefrontField, boolean>>,
): StorefrontVisibility {
  const resolved = {} as Record<StorefrontField, boolean>;

  for (const field of STOREFRONT_FIELDS) {
    resolved[field] = visibilityOf(vendor, platform, field).shown;
  }

  return resolved;
}

/**
 * The same decision for one field, with the level that made it.
 *
 * Separate from the map above because the two screens need different halves:
 * the storefront needs only the booleans, and the staff panel needs to render
 * "Use default (shown)" — which requires knowing that nothing overrode it.
 */
export function visibilityOf(
  vendor:
    { storefrontVisibility?: Partial<Record<StorefrontField, boolean>> } | null | undefined,
  platform: Partial<Record<StorefrontField, boolean>>,
  field: StorefrontField,
): { shown: boolean; source: VisibilitySource } {
  const override = vendor?.storefrontVisibility?.[field];
  if (typeof override === "boolean") return { shown: override, source: "vendor" };

  const platformValue = platform[field];
  if (typeof platformValue === "boolean") {
    return { shown: platformValue, source: "platform" };
  }

  return { shown: STOREFRONT_FIELDS_SHOWN_BY_DEFAULT, source: "default" };
}

/** The fields staff have switched off — what the vendor's own preview names back to them. */
export function hiddenStorefrontFields(
  visibility: StorefrontVisibility,
): readonly StorefrontField[] {
  return STOREFRONT_FIELDS.filter((field) => !visibility[field]);
}
