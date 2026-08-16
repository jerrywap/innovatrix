import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Terms",
  description: "The terms that apply to using Innovatrix.",
  path: "/terms",
});

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader title="Terms" description="The terms that apply to using Innovatrix." />
      <div className="mt-8">
        <EmptyState
          icon={FileText}
          title="Terms not yet published"
          description="Our terms of service will be published here before launch."
        />
      </div>
    </div>
  );
}
