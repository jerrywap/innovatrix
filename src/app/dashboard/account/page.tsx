import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/dal";
import { preferencesFor } from "@/services/notifications/notification-service";
import { NotificationPreferences } from "@/features/notifications/components/preferences";

export const metadata: Metadata = { title: "Account" };

/**
 * Account settings.
 *
 * Notification preferences (§69, ticket 24) live here. Name, email and password
 * are ticket 03's and still unbuilt — the section below is the only part of
 * this screen that is real, and saying so beats an empty state that implies
 * the whole page is coming.
 */
export default async function Page() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Account" description="How we get in touch with you." />

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
        <Preferences userId={user.id} />
      </Suspense>

      <section className="border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-[13px]">
        Changing your name, email address or password isn&rsquo;t here yet.
      </section>
    </div>
  );
}

async function Preferences({ userId }: { userId: string }) {
  const muted = await preferencesFor(userId);
  return <NotificationPreferences muted={[...muted]} />;
}
