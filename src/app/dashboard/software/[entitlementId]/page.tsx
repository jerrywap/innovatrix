import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { Download, KeyRound, Lock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { formatBytes } from "@/lib/format-bytes";
import { requireOrg } from "@/lib/auth/dal";
import { getOwnedSoftware } from "@/services/entitlements/entitlement-service";

export const metadata: Metadata = { title: "Software" };

/**
 * One owned product — §29's detail view.
 *
 * ## A locked version still renders, with its files listed
 *
 * A version outside the update window shows what is in it and why it is not
 * included, rather than being hidden. Hiding it makes the customer think the
 * release does not exist; showing it locked tells them exactly what extending
 * updates would buy.
 */
/**
 * ## `notFound()` here renders the 404 page under a 200, and that is the segment's doing
 *
 * Measured, not assumed: a foreign entitlement id returns **200** with the
 * not-found body. `src/app/dashboard/loading.tsx` wraps every route in this
 * segment in an implicit Suspense boundary, so the shell flushes before any page
 * resolves and the status is already committed by the time `notFound()` runs.
 * Delete that file and the same request returns a real 404 — which is how the
 * cause was confirmed, and how `/marketplace/[slug]` (no `loading.tsx` above it)
 * gets its 404.
 *
 * Kept as-is deliberately. These routes read `headers()` through the DAL, so
 * they are dynamic and there is a real gap before first paint — which is why
 * ticket 04 required a `loading.tsx` per protected segment in the first place.
 * The customer sees the right page either way; what the 200 costs is uptime
 * checks and any client that branches on `res.ok`, and nothing behind a login
 * does. Reconsider only if something starts consuming these routes
 * programmatically.
 *
 * The lookup is still awaited at page level rather than in a nested boundary:
 * with the segment fallback already in place a second one around a single query
 * bought nothing.
 */
export default async function Page({
  params,
}: PageProps<"/dashboard/software/[entitlementId]">) {
  const { entitlementId } = await params;
  const { organizationId } = await requireOrg();

  const owned = await getOwnedSoftware(entitlementId, organizationId);
  // Scoped, so another organisation's entitlement is a 404 rather than a 403 —
  // there is no reason for them to learn it exists.
  if (!owned) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={owned.product.name}
        description={
          owned.purchasedVersion
            ? `You bought v${owned.purchasedVersion.version}. It stays yours permanently.`
            : "Your licence and downloads."
        }
      />

      <div className="flex flex-wrap gap-3">
        {owned.licence && (
          <Link
            href={`/dashboard/software/${owned.id}/licence` as Route}
            className="border-border hover:bg-surface-muted flex items-center gap-2 rounded-full border px-4 py-2 text-[13px]"
          >
            <KeyRound className="size-3.5" aria-hidden />
            Licence and activations
          </Link>
        )}
        <Link
          href={`/marketplace/${owned.product.slug}` as Route}
          className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13px]"
        >
          Product page
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Versions and downloads</h2>

        <ul className="border-border divide-border divide-y rounded-xl border">
          {owned.versions.map((version) => (
            <li key={version.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="font-mono text-[13.5px] font-medium">v{version.version}</span>
                {version.isPurchased && (
                  <span className="rounded-full bg-[var(--signal)]/12 px-2 py-0.5 font-mono text-[9.5px] tracking-[0.14em] text-[var(--signal)] uppercase">
                    yours
                  </span>
                )}
                {version.releasedAt && (
                  <span className="text-subtle font-mono text-[11px]">
                    {version.releasedAt}
                  </span>
                )}
                {!version.access.allowed && (
                  <span className="text-subtle flex items-center gap-1 text-[11.5px]">
                    <Lock className="size-3" aria-hidden />
                    not included
                  </span>
                )}
              </div>

              {version.changelog && (
                <p className="text-muted-foreground text-[12.5px]">{version.changelog}</p>
              )}

              {!version.access.allowed && (
                <p className="border-border text-muted-foreground rounded-lg border border-dashed px-3 py-2 text-[12.5px]">
                  {version.access.message}
                </p>
              )}

              {version.files.length > 0 && (
                <ul className="flex flex-col gap-1.5">
                  {version.files.map((file) => (
                    <li
                      key={file.id}
                      className="border-border bg-surface flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px]">{file.filename}</span>
                        <span className="text-subtle font-mono text-[10.5px]">
                          {formatBytes(file.sizeBytes)}
                          {/* §44 — shown so a customer can verify what they
                              downloaded is what we shipped. */}
                          {file.checksumSha256
                            ? ` · sha256 ${file.checksumSha256.slice(0, 16)}…`
                            : " · checksum on first download"}
                        </span>
                      </span>

                      {version.access.allowed ? (
                        <a
                          href={`/api/downloads/${file.id}`}
                          className="bg-foreground text-background flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium"
                        >
                          <Download className="size-3.5" aria-hidden />
                          Download
                        </a>
                      ) : (
                        <span className="text-subtle text-[12px]">Locked</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
