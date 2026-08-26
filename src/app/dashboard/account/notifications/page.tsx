import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/dal";
import { preferencesFor } from "@/services/notifications/notification-service";
import { NotificationPreferences } from "@/features/notifications/components/preferences";

export const metadata: Metadata = { title: "Notification settings" };

/**
 * Which categories email you.
 *
 * The mechanism behind this screen is unchanged and was already working:
 * `enabledChannels()` reads the stored mute list before every non-essential
 * delivery, and the integration test proves a muted category stops that person's
 * email while a colleague who has not muted it still gets theirs. What moved is
 * only where the switches live and how they read.
 *
 * This is the *preferences* screen; `/dashboard/notifications` is the inbox. Two
 * routes on purpose — one answers "what should reach me", the other "what
 * reached me".
 */
export default async function Page() {
  const user = await requireUser();

  return (
    <div className="flex flex-col gap-6">
      <Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
        <Preferences userId={user.id} />
      </Suspense>

      <p className="text-muted-foreground text-[13px]">
        Looking for what you have already been sent?{" "}
        <Link href="/dashboard/notifications" className="underline underline-offset-4">
          Your notifications
        </Link>
        .
      </p>
    </div>
  );
}

async function Preferences({ userId }: { userId: string }) {
  const muted = await preferencesFor(userId);
  return <NotificationPreferences muted={[...muted]} />;
}
