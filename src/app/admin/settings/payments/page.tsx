import type { Metadata } from "next";
import { Suspense } from "react";
import { CircleCheck, CircleX, KeyRound, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadPaymentSettings } from "@/features/payments/settings-view";
import { ProviderToggle } from "@/features/payments/components/provider-toggle";
import { RoutingRow } from "@/features/payments/components/routing-row";
import { CopyField } from "@/features/product/copy-field";
import { OfflineSettings } from "@/features/payments/components/offline-settings";

export const metadata: Metadata = { title: "Payments" };

/**
 * Payment provider configuration — §62, §88.
 *
 * ## No secret reaches this page
 *
 * Every provider row shows the **name** of the environment variable its key
 * lives in and a tick or a cross for whether it is present. There is no input
 * that writes a key, and no value crosses the RSC boundary — `loadPaymentSettings`
 * reduces `serverEnv()` to a boolean before returning.
 */
export default async function Page() {
  await requirePermissionOrForbid("payment_provider.configure");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Payments"
        description="Which provider takes money in which currency. Keys live in the environment, never here."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  const view = await loadPaymentSettings();

  return (
    <div className="flex flex-col gap-8">
      <OfflineSettings
        enabled={view.offline.enabled}
        instructions={view.offline.instructions}
      />

      {view.uncovered.length > 0 && (
        <p className="flex items-start gap-2.5 rounded-xl border border-[var(--danger)]/40 bg-[var(--danger)]/5 px-4 py-3 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-[var(--danger)]" aria-hidden />
          <span>
            <strong className="font-medium">
              No provider can take {view.uncovered.join(", ")}.
            </strong>{" "}
            The marketplace prices in {view.uncovered.length === 1 ? "it" : "them"}, so checkout
            will refuse at the last step. Enable a provider that supports{" "}
            {view.uncovered.length === 1 ? "it" : "them"}, or stop pricing in{" "}
            {view.uncovered.length === 1 ? "it" : "them"}.
          </span>
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">Providers</h2>

        <ul className="border-border divide-border divide-y rounded-xl border">
          {view.providers.map((provider) => (
            <li key={provider.key} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] font-medium">{provider.label}</p>
                  <p className="text-subtle font-mono text-[11px]">
                    {provider.supportedCurrencies.join(" · ")}
                  </p>
                </div>
                <ProviderToggle
                  provider={provider.key}
                  enabled={provider.enabled}
                  mode={provider.mode}
                />
              </div>

              <div className="border-border bg-surface-muted flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
                <KeyRound className="text-subtle size-3.5 shrink-0" aria-hidden />
                <code className="font-mono text-[12px]">{provider.secretEnvVar}</code>
                {provider.secretPresent ? (
                  <span className="flex items-center gap-1 text-[12px] text-emerald-700 dark:text-emerald-400">
                    <CircleCheck className="size-3.5" aria-hidden />
                    set
                  </span>
                ) : (
                  <span className="text-subtle flex items-center gap-1 text-[12px]">
                    <CircleX className="size-3.5" aria-hidden />
                    not set
                  </span>
                )}
                <span className="text-subtle ml-auto text-[11px]">
                  Set in the environment. Never stored here.
                </span>
              </div>

              {provider.misconfigured && (
                <p className="flex items-center gap-2 text-[12.5px] text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
                  Enabled, but {provider.secretEnvVar} is not set — this provider will be
                  skipped.
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Currency routing</h2>
          <p className="text-muted-foreground text-[13px]">
            Which provider is tried first for each currency, and what happens if it can&rsquo;t.
          </p>
        </div>

        <ul className="border-border divide-border divide-y rounded-xl border">
          {view.routing.map((route) => (
            <li key={route.currency} className="p-4">
              <RoutingRow route={route} />
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-[17px] tracking-[-0.02em]">Webhook URLs</h2>
          <p className="text-muted-foreground text-[13px]">
            Register these in each provider&rsquo;s dashboard. They are public by design — the
            signature is the authentication.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {view.webhookUrls.map((entry) => (
            <CopyField key={entry.provider} label={entry.provider} value={entry.url} />
          ))}
        </div>
      </section>
    </div>
  );
}
