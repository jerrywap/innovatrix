import type { Metadata } from "next";
import { Shield } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Privacy",
  description: "What we collect, why, and what we do with it.",
  path: "/privacy",
});

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader title="Privacy" description="What we collect, why, and what we do with it." />
      <div className="mt-8">
        <EmptyState
          icon={Shield}
          title="Privacy notice not yet published"
          description="Our privacy notice will be published here before launch."
        />
      </div>
    </div>
  );
}
