import type { Metadata } from "next";
import { Wrench } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Build custom software",
  description: "Describe what you need. We scope it, quote it, and build it.",
};

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Build custom software"
        description="Describe what you need. We scope it, quote it, and build it."
      />
      <div className="mt-8">
        <EmptyState
          icon={Wrench}
          title="The guided brief is on its way"
          description="This is where the AI assistant takes you through what you need and turns it into a request we can quote."
        />
      </div>
    </div>
  );
}
