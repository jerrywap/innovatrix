import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { StorefrontDefaultsForm } from "@/features/vendors/components/storefront-visibility-panel";
import { platformStorefrontDefaults } from "@/services/vendors/storefront-visibility";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Settings" };

/**
 * Platform configuration that has no screen of its own.
 *
 * This was an `EmptyState` promising that "platform-wide settings will be
 * managed from this screen", which is now true of one of them. The specific
 * settings that already had a reason to be their own page still are —
 * `/admin/settings/commission`, `/payments`, `/tax`, `/ai` — each because it
 * carries its own permission. This screen holds what `settings.manage` covers.
 *
 * ## Why the storefront defaults are here rather than under `/staff`
 *
 * The per-vendor override lives on the staff vendor screen, because it is a
 * judgement about one vendor. This is the opposite: a rule about every
 * storefront at once, which is configuration. The split is the same one
 * `/admin/settings/commission` already makes against the vendor rate on the
 * staff screen — and the same permission split, since deciding for everybody is
 * `settings.manage` and deciding about one vendor is `vendor.review`.
 */
export default async function Page() {
  // Nav filtering decides what is drawn; this decides what is allowed.
  await requirePermissionOrForbid("settings.manage");

  const defaults = await platformStorefrontDefaults();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Platform configuration." />
      <div className="max-w-3xl">
        <StorefrontDefaultsForm current={defaults} />
      </div>
    </div>
  );
}
