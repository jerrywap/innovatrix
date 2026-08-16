import type { Metadata } from "next";
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Terms",
  description: "The terms that apply to using Innovatrix.",
};

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
