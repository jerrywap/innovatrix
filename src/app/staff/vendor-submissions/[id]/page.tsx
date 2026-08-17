import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { products } from "@/repositories/product.repository";
import { toStaffReviewNotes } from "@/services/catalog/product-view";
import { readinessFor } from "@/services/catalog/product-service";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";
import { ReviewDecision } from "@/features/products/components/review-decision";

export const metadata: Metadata = { title: "Submission" };

/**
 * One submission, for a reviewer — vendor ticket 05.
 *
 * The guard is awaited before any JSX and there is no `<Suspense>` around the load:
 * the 404 depends on the main query, so there is nothing to stream ahead of it and
 * blocking is correct rather than a regression.
 *
 * Staff read **`toStaffReviewNotes`** here, which is the projection that *does* carry
 * `internalNote` — they wrote those notes and may read them. The vendor's own screen
 * uses `toVendorReviewNotes`, which cannot.
 */
export default async function Page({ params }: PageProps<"/staff/vendor-submissions/[id]">) {
  await requirePermissionOrForbid("product.review");

  const { id } = await params;
  const parsed = objectIdSchema.safeParse(id);
  if (!parsed.success) notFound();

  const product = await products.findById(parsed.data);
  if (!product) notFound();

  const readiness = await readinessFor(product);
  const notes = toStaffReviewNotes(product);
  const latestSubmission = [...notes].reverse().find((note) => note.outcome === "submitted");

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={product.name}
        description={product.summary}
        breadcrumbs={[
          { label: "Submissions", href: "/staff/vendor-submissions" },
          { label: product.name },
        ]}
        actions={<StatusBadge status={product.status} />}
      />

      <section className="flex flex-col gap-3">
        <dl className="border-border grid gap-x-8 gap-y-3 rounded-xl border p-5 text-[13px] sm:grid-cols-2">
          <Row label="Seller">{product.vendorName ?? "Innovatrix"}</Row>
          <Row label="Submitted">
            {latestSubmission ? formatDateTime(latestSubmission.at) : "—"}
          </Row>
          <Row label="Attestation">
            {/*
              The record a takedown is weighed against (vendor ticket 13). The version
              is shown rather than the text: what matters here is *which* declaration
              was accepted and when.
            */}
            {product.attestation
              ? `${product.attestation.statementVersion} · ${formatDateTime(product.attestation.at)}`
              : "Not given"}
          </Row>
          <Row label="Version submitted">{product.attestation?.versionAtSubmission ?? "—"}</Row>
          <Row label="Changed since approval">
            {latestSubmission?.changedSections.length
              ? latestSubmission.changedSections.join(", ")
              : "—"}
          </Row>
          <Row label="Edit">
            <Link
              href={`/admin/products/${String(product._id)}/basics`}
              className="underline underline-offset-4"
            >
              Open in the product wizard
            </Link>
          </Row>
        </dl>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Readiness</h2>
        <p className="text-muted-foreground text-[13px]">
          The same checks the vendor saw before submitting, and the same ones that gate
          publication.
        </p>
        <div className="border-border rounded-xl border p-5">
          <ReadinessGaps gaps={readiness.gaps} productId={String(product._id)} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Decide</h2>
        <ReviewDecision productId={String(product._id)} status={product.status} />
      </section>

      {notes.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">History</h2>
          <ol className="border-border divide-border divide-y rounded-xl border">
            {[...notes].reverse().map((note, index) => (
              <li key={`${note.at}-${index}`} className="flex flex-col gap-2 px-4 py-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge
                    status={note.outcome === "approved" ? "approved" : note.outcome}
                  />
                  <span className="text-subtle font-mono text-[11px]">
                    {formatDateTime(note.at)}
                  </span>
                </div>
                <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">
                  {note.detail}
                </p>
                {note.reasons.length > 0 && (
                  <p className="text-subtle text-[12px] capitalize">
                    {note.reasons.join(", ")}
                  </p>
                )}
                {note.internalNote && (
                  <p className="border-signal/25 bg-signal-soft text-signal-text rounded-lg border px-3 py-2 text-[12.5px] whitespace-pre-wrap">
                    <span className="font-mono text-[9.5px] tracking-[0.16em] uppercase">
                      Internal
                    </span>
                    <br />
                    {note.internalNote}
                  </p>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
        {label}
      </dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}
