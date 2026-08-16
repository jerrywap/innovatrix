import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { loadAiSettings } from "@/features/ai-settings/settings-view";
import { AiSettingsForm } from "@/features/ai-settings/components/settings-form";

export const metadata: Metadata = { title: "AI" };

/**
 * Which model the assistants use — §104, ticket 16.
 *
 * ## Why this screen exists at all
 *
 * §104 requires the platform to keep working when an AI provider misbehaves.
 * Doing that from `OPENROUTER_MODEL` alone means a redeploy at the moment
 * something is on fire. Here, an administrator switches model or reorders the
 * fallbacks and the next request uses it.
 *
 * Gated on `ai.configure` rather than `settings.manage`: this one lever changes
 * what every customer conversation costs and how well it behaves, which is
 * worth being able to grant — and audit — on its own.
 */
export default async function Page() {
  await requirePermissionOrForbid("ai.configure");

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="AI"
        description="Which model runs the assistants, and what happens when it doesn't. Keys live in the environment, never here."
      />
      <Suspense fallback={<Skeleton className="h-[32rem] w-full rounded-xl" />}>
        <Settings />
      </Suspense>
    </div>
  );
}

async function Settings() {
  return <AiSettingsForm view={await loadAiSettings()} />;
}
