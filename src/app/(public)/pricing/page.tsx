import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Pricing",
  description: "What things cost, and how quotes work.",
};

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader title="Pricing" description="What things cost, and how quotes work." />
      <div className="mt-8">
        <EmptyState
          icon={Receipt}
          title="Pricing detail coming"
          description="Marketplace products are individually priced. Custom work is quoted after we've scoped it."
        />
      </div>
    </div>
  );
}
