import type { Metadata } from "next";
import { Receipt } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Pricing",
  description: "What things cost, and how quotes work.",
  path: "/pricing",
});

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
