import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpCircle, KeyRound, MonitorPlay, Package, Sparkles } from "lucide-react";
import { StatusBadge } from "@/components/status-badge";
import type { EntitlementView } from "@/services/entitlements/entitlement-service";

/**
 * One owned product — §29.
 *
 * ## The actions are the point
 *
 * §29 lists eight, and §102 says prioritise actions over decoration. So the
 * card is mostly links, and each one carries the context the destination needs
 * — "Request customization" goes with **the version this customer owns**, not
 * just the product, because §101 requires context to flow rather than being
 * re-asked.
 *
 * Five of the eight are here: Download, View Licence, Open Demo, Request
 * Customization, and View Changelog (per version, on the detail page). The
 * other three are absent for reasons worth stating rather than leaving as
 * silently missing buttons:
 *
 * - **Documentation** — there is no documentation field on `ProductDoc`. A link
 *   with nothing behind it is worse than no link.
 * - **Request Installation** — §29 says this adds the installation add-on to
 *   the cart, and ticket 10's cart cannot express it: add-ons hang off a
 *   `parentLineId`, so there is no way to buy an installation for a licence you
 *   already own without a standalone service line. That is a change to the cart
 *   model, not a button.
 * - **Request Support** — opens a request/conversation, which is ticket 17.
 *
 * ## "Update available" means genuinely available
 *
 * `updateAvailable` is only set when `canDownload` says so, not when a newer
 * version merely exists. A badge that offers a download the server then refuses
 * is worse than no badge.
 */
export function SoftwareCard({ entitlement }: { entitlement: EntitlementView }) {
  const detailHref = `/dashboard/software/${entitlement.id}` as Route;

  return (
    <article className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4">
      <div className="flex gap-4">
        {entitlement.product.imageUrl ? (
          <Image
            src={entitlement.product.imageUrl}
            alt=""
            width={88}
            height={66}
            className="border-border bg-surface-muted h-[66px] w-[88px] shrink-0 rounded-lg border object-cover"
          />
        ) : (
          <div className="border-border bg-surface-muted flex h-[66px] w-[88px] shrink-0 items-center justify-center rounded-lg border">
            <Package className="text-subtle size-5" aria-hidden />
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link href={detailHref} className="text-[15px] font-medium hover:underline">
              {entitlement.product.name}
            </Link>
            {entitlement.status !== "active" && <StatusBadge status={entitlement.status} />}
          </div>

          <p className="text-subtle font-mono text-[11.5px]">
            {entitlement.purchasedVersion
              ? `You own v${entitlement.purchasedVersion.version}`
              : "Version not recorded"}
          </p>

          {entitlement.updateAvailable && (
            <p className="flex items-center gap-1.5 text-[12.5px] text-emerald-700 dark:text-emerald-400">
              <ArrowUpCircle className="size-3.5" aria-hidden />v
              {entitlement.updateAvailable.version} is available and included
            </p>
          )}
        </div>
      </div>

      <dl className="border-border grid grid-cols-2 gap-x-4 gap-y-1 border-t pt-3 text-[12px]">
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Updates</dt>
          <dd className={entitlement.updatesActive ? "" : "text-subtle"}>
            {entitlement.updatesUntil
              ? entitlement.updatesActive
                ? `until ${entitlement.updatesUntil}`
                : `ended ${entitlement.updatesUntil}`
              : "not included"}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-subtle">Support</dt>
          <dd className={entitlement.supportActive ? "" : "text-subtle"}>
            {entitlement.supportUntil
              ? entitlement.supportActive
                ? `until ${entitlement.supportUntil}`
                : `ended ${entitlement.supportUntil}`
              : "not included"}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Action href={detailHref} primary>
          Downloads
        </Action>

        {entitlement.licence && (
          <Action href={`${detailHref}/licence` as Route}>
            <KeyRound className="size-3.5" aria-hidden />
            Licence
          </Action>
        )}

        {entitlement.product.customisable && (
          <Action
            // §101 — the version they *own* travels with the request, so the
            // ticket-17 assistant does not have to ask what they already told
            // us by buying it.
            href={
              (`/customize/${entitlement.product.slug}` +
                `${entitlement.purchasedVersion ? `?version=${entitlement.purchasedVersion.version}` : ""}`) as Route
            }
          >
            <Sparkles className="size-3.5" aria-hidden />
            Request customization
          </Action>
        )}

        {entitlement.product.hasDemo && (
          // Straight to the demo section of the product page, which already
          // resolves §9 exposure per viewer. An owner passes `owners_only` by
          // definition, so this is the one place that rule pays off — nothing
          // here re-implements it.
          <Action href={`/marketplace/${entitlement.product.slug}#demo` as Route}>
            <MonitorPlay className="size-3.5" aria-hidden />
            Open demo
          </Action>
        )}

        <Action href={`/marketplace/${entitlement.product.slug}` as Route}>Product page</Action>
      </div>
    </article>
  );
}

function Action({
  href,
  children,
  primary,
}: {
  href: Route;
  children: React.ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      href={href}
      className={
        primary
          ? "bg-foreground text-background flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12.5px] font-medium"
          : "border-border hover:bg-surface-muted flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[12.5px]"
      }
    >
      {children}
    </Link>
  );
}
