import type { Metadata } from "next";
import { Settings } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Services",
  description: "Installation, deployment, support and maintenance around the software you run.",
  path: "/services",
});

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
