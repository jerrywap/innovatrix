import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/format-bytes";
import { formatDateTime } from "@/lib/dates";
import { can, requireAnyPermissionOrForbid } from "@/lib/auth/dal";
import { objectIdSchema } from "@/validators/common";
import { findById } from "@/services/vendors/vendor-service";
import { listDocuments } from "@/services/vendors/document-service";
import { listMembers } from "@/services/vendors/member-service";
import {
  ApplicationDecision,
  VerificationDecision,
} from "@/features/vendors/components/review-panel";
import { VendorMoney } from "@/features/vendors/components/vendor-money";
import { LifecyclePanel } from "@/features/vendors/components/lifecycle-panel";
import { StorefrontVisibilityPanel } from "@/features/vendors/components/storefront-visibility-panel";
import {
  platformStorefrontDefaults,
  resolveStorefrontVisibility,
} from "@/services/vendors/storefront-visibility";

export const metadata: Metadata = { title: "Vendor" };

/**
 * One vendor, for staff — vendor tickets 01 and 02.
 *
 * The guard is awaited before any JSX, and there is no `<Suspense>` around the
 * load: the 404 depends on the main query, so there is nothing to stream ahead of
 * it and blocking is correct rather than a regression.
 *
 * Two permissions are read separately. `vendor.review` decides applications and
 * `vendor.verify` decides evidence — `finance` holds the second and not the first,
 * so a finance user sees the verification panels and not the reject button. Both
 * are re-checked in the actions; this only decides what is drawn.
 */
export default async function Page({ params }: PageProps<"/staff/vendor-applications/[id]">) {
  // Four permissions reach this screen, and each section below is gated on its own.
  // `vendor.view_ledger` is here because `finance` may need a vendor's money without
  // holding either review permission — a page gated more narrowly than its contents
  // would be a 403 for somebody entitled to half of it.
  await requireAnyPermissionOrForbid(["vendor.review", "vendor.verify", "vendor.view_ledger"]);

  const { id } = await params;
  const parsed = objectIdSchema.safeParse(id);
  if (!parsed.success) notFound();

  const vendor = await findById(parsed.data);
  if (!vendor) notFound();

  const vendorId = String(vendor._id);
  const [
    documents,
    members,
    mayReview,
    mayVerify,
    mayReadDocuments,
    mayReadLedger,
    mayManageCommission,
    mayAdjust,
    maySuspend,
    mayOffboard,
    storefrontDefaults,
  ] = await Promise.all([
    listDocuments(vendorId),
    listMembers(vendorId),
    can("vendor.review"),
    can("vendor.verify"),
    can("vendor.view_documents"),
    // Vendor tickets 07–08. Three permissions, read separately, because the roles
    // that hold them barely overlap: `finance` reads the ledger and adjusts it,
    // `marketplace_manager` sets the rate and reads the ledger, and neither is a
    // superset of the other.
    can("vendor.view_ledger"),
    can("vendor.manage_commission"),
    can("vendor.adjust_ledger"),
    // Vendor ticket 12. Suspension is reversible and sits with the marketplace; offboarding is
    // not, happens with money owed, and is `super_admin` only.
    can("vendor.suspend"),
    can("vendor.offboard"),
    // In the same fan-out as the permission reads rather than behind the panel:
    // it is one indexed `findOne` and the panel is rendered inline, so a second
    // await here would be a second round trip for no streaming benefit.
    platformStorefrontDefaults(),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <PageHeader
        title={vendor.displayName}
        description={vendor.contactEmail}
        breadcrumbs={[
          { label: "Vendors", href: "/staff/vendor-applications" },
          { label: vendor.displayName },
        ]}
        actions={<StatusBadge status={vendor.status} />}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">The application</h2>
        <dl className="border-border grid gap-x-8 gap-y-3 rounded-xl border p-5 text-[13px] sm:grid-cols-2">
          <Row label="Storefront">/vendors/{vendor.slug}</Row>
          <Row label="Country">{vendor.country}</Row>
          <Row label="Applied">{formatDateTime(vendor.appliedAt)}</Row>
          <Row label="Agreement">
            {vendor.agreement
              ? `${vendor.agreement.version} · ${formatDateTime(vendor.agreement.acceptedAt)}`
              : "—"}
          </Row>
          {vendor.profile.websiteUrl && <Row label="Website">{vendor.profile.websiteUrl}</Row>}
          {vendor.verifiedAt && <Row label="Verified">{formatDateTime(vendor.verifiedAt)}</Row>}
        </dl>

        <div className="border-border rounded-xl border p-5">
          <h3 className="text-subtle mb-2 font-mono text-[9.5px] tracking-[0.16em] uppercase">
            What they build
          </h3>
          {/* Rendered as text, escaped by React. This is attacker-controlled prose
              on a staff screen. */}
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap">{vendor.pitch}</p>
        </div>
      </section>

      {mayReview && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Decide</h2>
          <ApplicationDecision
            vendorId={vendorId}
            status={vendor.status}
            canVerify={vendor.verification.identity.status === "approved"}
          />
        </section>
      )}

      <section className="flex flex-col gap-5">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Verification</h2>

        {(["identity", "business"] as const).map((level) => {
          const forLevel = documents.filter((document) => document.level === level);
          const state = vendor.verification[level];

          return (
            <div
              key={level}
              className="border-border flex flex-col gap-3 rounded-xl border p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-medium capitalize">{level}</h3>
                <StatusBadge status={state.status} />
              </div>

              {forLevel.length === 0 ? (
                <p className="text-subtle text-[12.5px]">Nothing uploaded.</p>
              ) : (
                <ul className="divide-border divide-y">
                  {forLevel.map((document) => (
                    <li
                      key={String(document._id)}
                      className="flex flex-wrap items-center justify-between gap-3 py-2"
                    >
                      {/*
                        A link to the authorised route, never to the object. The
                        bucket answers any known key over plain HTTPS with no
                        signature, so the route is the only thing protecting this —
                        it checks the permission, records who looked, and then
                        redirects to a five-minute signed URL.
                      */}
                      {mayReadDocuments && !document.purgedAt ? (
                        <a
                          href={`/api/vendor-documents/${String(document._id)}`}
                          className="flex min-w-0 items-center gap-2 text-[13px] underline underline-offset-4"
                        >
                          <FileText className="text-subtle size-4 shrink-0" aria-hidden />
                          <span className="truncate">{document.filename}</span>
                        </a>
                      ) : (
                        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-[13px]">
                          <FileText className="text-subtle size-4 shrink-0" aria-hidden />
                          <span className="truncate">{document.filename}</span>
                          {document.purgedAt && <span className="text-subtle">— removed</span>}
                        </span>
                      )}
                      <span className="text-subtle shrink-0 font-mono text-[11px]">
                        {document.kind} · {formatBytes(document.sizeBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {mayVerify && state.status !== "approved" && (
                <VerificationDecision
                  vendorId={vendorId}
                  level={level}
                  documentCount={forLevel.filter((document) => !document.purgedAt).length}
                />
              )}
            </div>
          );
        })}

        {vendor.verificationDecisions.length > 0 && (
          <div className="border-border rounded-xl border p-5">
            <h3 className="text-subtle mb-3 font-mono text-[9.5px] tracking-[0.16em] uppercase">
              Decision history
            </h3>
            <ul className="divide-border divide-y text-[13px]">
              {vendor.verificationDecisions.map((decision, index) => (
                <li key={index} className="flex flex-col gap-0.5 py-2">
                  <span>
                    <span className="capitalize">{decision.level}</span>{" "}
                    <StatusBadge status={decision.outcome} />{" "}
                    <span className="text-subtle font-mono text-[11px]">
                      {formatDateTime(decision.at)} · {decision.documentHashes.length} checksum
                      {decision.documentHashes.length === 1 ? "" : "s"}
                    </span>
                  </span>
                  {decision.note && (
                    <span className="text-muted-foreground">{decision.note}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {(mayReadLedger || mayManageCommission) && (
        <Suspense fallback={<Skeleton className="h-64 w-full rounded-xl" />}>
          <VendorMoney
            vendorId={vendorId}
            canReadLedger={mayReadLedger}
            canManageCommission={mayManageCommission}
            canAdjust={mayAdjust}
          />
        </Suspense>
      )}

      {/*
        `vendor.review`, not a new permission.

        The three vendor permissions are split by blast radius, and deciding what a
        live storefront may show sits with `vendor.suspend` and `review.moderate` —
        `marketplace_manager`'s commercial and editorial call. `finance` holds
        `vendor.verify` and not `vendor.review`, so this keeps finance out, which is
        the right answer and one a ninth permission would have had to reproduce by
        hand in every role or fail `assertMatrixIsComplete()`.
      */}
      {mayReview && (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">
            What their storefront shows
          </h2>
          <StorefrontVisibilityPanel
            vendorId={vendorId}
            current={vendor.storefrontVisibility ?? {}}
            // What "Use default" resolves to right now, so the option can say which it
            // is. Resolved against *no* vendor deliberately — the platform answer is
            // what the option describes, and passing this vendor would make every row
            // read back its own override.
            platform={resolveStorefrontVisibility(null, storefrontDefaults)}
          />
        </section>
      )}

      <LifecyclePanel
        vendorId={vendorId}
        vendorName={vendor.displayName}
        status={vendor.status}
        canSuspend={maySuspend}
        canOffboard={mayOffboard}
      />

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-[15.5px] tracking-[-0.02em]">Who has access</h2>
        <ul className="border-border divide-border divide-y rounded-xl border text-[13px]">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5"
            >
              <span className="min-w-0">
                <span className="truncate">{member.name}</span>
                <span className="text-subtle ml-2 font-mono text-[11px]">{member.email}</span>
              </span>
              <span className="flex items-center gap-2">
                <StatusBadge status={member.status} />
                <span className="text-subtle font-mono text-[9.5px] tracking-[0.16em] uppercase">
                  {member.role}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
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
