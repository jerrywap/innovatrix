import type { Metadata } from "next";
import Link from "next/link";
import { Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = { title: "My software" };

export default async function Page() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="My software"
        description="Everything you own, with its downloads and licence keys."
      />
      <EmptyState
        icon={Package}
        title="Nothing here yet"
        description="Software you buy or have built for you appears here, with its downloads and licence keys."
        action={
          <Button asChild>
            <Link href="/marketplace">Browse the marketplace</Link>
          </Button>
        }
      />
    </div>
  );
}
