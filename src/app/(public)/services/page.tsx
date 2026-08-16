import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export const metadata: Metadata = {
  title: "Services",
  description: "Installation, deployment, support and maintenance around the software you run.",
};

export default function Page() {
  return (
    <div className="mx-auto w-full max-w-[1180px] px-5 py-12 lg:px-10 lg:py-16">
      <PageHeader
        title="Services"
        description="Installation, deployment, support and maintenance around the software you run."
      />
      <div className="mt-8">
        <EmptyState
          icon={Settings}
          title="Service details coming"
          description="What we do beyond building: installation, hosting, support and ongoing maintenance."
        />
      </div>
    </div>
  );
}
