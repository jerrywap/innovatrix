import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { KeyRound } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { requireOrg } from "@/lib/auth/dal";
import { getOwnedSoftware } from "@/services/entitlements/entitlement-service";
import { licenceForEntitlement } from "@/services/entitlements/activation-service";
import { LicenceKeyField } from "@/features/software/components/licence-key-field";
import { ActivationList } from "@/features/software/components/activation-list";

export const metadata: Metadata = { title: "Licence" };

/**
 * The licence — §65, ticket 14.
 *
 * ## The key is rendered, masked, with a reveal
 *
 * It has to be: the customer needs to paste it into an installer. Masking is
 * shoulder-surfing protection for somebody on a shared screen, **not** a
 * security control — the value is already in this browser, and pretending
 * otherwise would be the kind of theatre that makes people distrust the parts
 * that are real.
 *
 * What *is* a control: `licenceForEntitlement` resolves through the
 * organisation, so a key can only be read by somebody in the organisation that
 * bought it. The key alone is enough to **activate** and deliberately not
 * enough to read a purchase history.
 */
const TYPE_COPY: Record<string, string> = {
  single_project: "One project. Use it in a single client build.",
  single_installation: "One installation. Install it on one site you control.",
  multi_installation: "Several installations, up to the limit below.",
  commercial: "Commercial use, including work you sell on.",
  developer: "Development and staging as well as production.",
  saas: "Run it as a hosted service for your own customers.",
  subscription: "Runs while the subscription does.",
  lifetime: "Yours permanently, with no expiry.",
};

/**
 * Awaited at page level — the segment's `loading.tsx` is already the fallback,
 * and a nested boundary around one query bought nothing. See the parent route's
 * page for why `notFound()` under this segment renders a 404 body with a 200.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/software/[entitlementId]/licence">) {
  const { entitlementId } = await params;
  const { organizationId } = await requireOrg();

  const [owned, licence] = await Promise.all([
    getOwnedSoftware(entitlementId, organizationId),
    licenceForEntitlement(entitlementId, organizationId),
  ]);

  if (!owned || !licence) notFound();

  const live = licence.activations.filter((activation) => !activation.releasedAt);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`${owned.product.name} licence`}
        description="Your key, what it permits, and where it's installed."
      />

      <Link
        href={`/dashboard/software/${entitlementId}` as Route}
        className="text-subtle w-fit text-[12.5px] underline underline-offset-4"
      >
        ← Back to downloads
      </Link>

      <section className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display flex items-center gap-2 text-[16px] tracking-[-0.02em]">
            <KeyRound className="text-subtle size-4" aria-hidden />
            Licence key
          </h2>
          <StatusBadge status={licence.status} />
        </div>

        <LicenceKeyField licenceKey={licence.key} />

        <dl className="border-border grid gap-x-6 gap-y-3 border-t pt-4 sm:grid-cols-2">
          <Row
            term="What it permits"
            detail={TYPE_COPY[licence.type] ?? licence.type.replace(/_/g, " ")}
          />
          <Row
            term="Installations"
            detail={`${live.length} of ${licence.activationLimit} in use`}
          />
          <Row
            term="Updates"
            detail={
              owned.updatesUntil
                ? owned.updatesActive
                  ? `New versions are included until ${owned.updatesUntil}. After that you keep everything released before then, permanently.`
                  : `Included until ${owned.updatesUntil}. Versions released since then aren't part of this purchase — the version you bought stays yours.`
                : "New versions aren't included in this purchase."
            }
          />
          <Row
            term="Support"
            detail={
              owned.supportUntil
                ? owned.supportActive
                  ? `We'll help with problems until ${owned.supportUntil}.`
                  : `Support ended ${owned.supportUntil}. Get in touch if you'd like to extend it.`
                : "Support isn't included in this purchase."
            }
          />
          {licence.expiresAt && (
            <Row
              term="Expires"
              detail={new Date(licence.expiresAt).toLocaleDateString("en-GB")}
            />
          )}
        </dl>
      </section>

      <ActivationList
        entitlementId={entitlementId}
        activationLimit={licence.activationLimit}
        activations={licence.activations.map((activation) => ({
          instanceId: activation.instanceId,
          ...(activation.domain ? { domain: activation.domain } : {}),
          activatedAt: new Date(activation.activatedAt).toISOString(),
          ...(activation.releasedAt
            ? { releasedAt: new Date(activation.releasedAt).toISOString() }
            : {}),
        }))}
      />
    </div>
  );
}

function Row({ term, detail }: { term: string; detail: string }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">{term}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed">{detail}</dd>
    </div>
  );
}
