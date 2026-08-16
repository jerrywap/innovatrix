import type { Metadata } from "next";
import { UserCog } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "Account" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Account" description="Your name, email and password." />
      <EmptyState
        icon={UserCog}
        title="Account settings"
        description="Change your name, email address and password here."
      />
    </div>
  );
}
