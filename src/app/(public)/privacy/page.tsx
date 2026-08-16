import type { Metadata } from "next";
import { Shield } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Privacy",
  description: "What we collect, why, and what we do with it.",
};

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
