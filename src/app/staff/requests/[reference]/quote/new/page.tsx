import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { CircleCheck, CircleDashed } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { Organization } from "@/lib/db/models/identity";
import { loadRequest } from "@/features/requests/request-view";
import { QuoteBuilder } from "@/features/quotes/components/quote-builder";

export const metadata: Metadata = { title: "New quote" };

/**
 * Writing a quote against a request — §51.
 *
 * ## The requirements are on screen while it is written
 *
 * §51 asks for this explicitly, and the reason is the failure it prevents: a
 * quote written from memory prices what the writer *remembers* being asked
 * for. Confirmed requirements on the left, assumptions below them and visibly
 * separate, so a line item covering something the customer never agreed to is
 * obvious while it is being typed rather than after it is sent.
 *
 * Gated on `quote.draft` — issuing needs `quote.issue`, checked in the service.
 */
export default async function Page({
  params,
}: PageProps<"/staff/requests/[reference]/quote/new">) {
  const { reference } = await params;
  await requirePermissionOrForbid("quote.draft");

  const request = await loadRequest(reference, { audience: "staff" });
  if (!request?.organizationId) notFound();

  await connectToDatabase();
  const organization = await Organization.findById(request.organizationId)
    .select({ name: 1, billingCurrency: 1 })
    .lean<{ name: string; billingCurrency?: string }>();

  // §51: the organisation's currency, overridable. No organisation currency
  // yet, so GBP is the platform default rather than a guess dressed as one.
  const currency = organization?.billingCurrency ?? "GBP";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Quote for ${request.reference}`}
        description={`${organization?.name ?? "Customer"} · ${request.title}`}
      />

      <p className="text-subtle text-[12.5px]">
        <Link
          href={`/staff/requests/${reference}` as Route}
          className="underline underline-offset-4"
        >
          ← Back to the request
        </Link>
      </p>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <QuoteBuilder
          requestId={request.id}
          reference={request.reference}
          organizationId={request.organizationId}
          currency={currency}
          defaultTitle={request.title}
        />

        <aside className="flex flex-col gap-4">
          <section className="border-border bg-surface flex flex-col gap-2 rounded-xl border p-4">
            <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
              What they confirmed
            </h2>
            <ul className="flex flex-col gap-1.5">
              {request.customerRequirements.map((requirement) => (
                <li key={requirement.key} className="flex items-start gap-2 text-[13px]">
                  <CircleCheck
                    className="mt-0.5 size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                    aria-hidden
                  />
                  {requirement.label}
                </li>
              ))}
            </ul>
          </section>

          {request.assumptions.length > 0 && (
            <section className="border-border bg-surface-muted flex flex-col gap-2 rounded-xl border border-dashed p-4">
              <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
                They did <em>not</em> confirm
              </h2>
              <p className="text-subtle text-[12px]">
                Quoting for one of these means quoting for something nobody asked for.
              </p>
              <ul className="flex flex-col gap-1.5">
                {request.assumptions.map((assumption) => (
                  <li
                    key={assumption.key}
                    className="text-muted-foreground flex items-start gap-2 text-[13px]"
                  >
                    <CircleDashed
                      className="text-subtle mt-0.5 size-3.5 shrink-0"
                      aria-hidden
                    />
                    {assumption.label}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {request.internalInterpretation && (
            <section className="border-border bg-surface-muted flex flex-col gap-2 rounded-xl border border-dashed p-4">
              <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
                Internal interpretation
              </h2>
              <p className="text-[13px] whitespace-pre-wrap">
                {request.internalInterpretation}
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
