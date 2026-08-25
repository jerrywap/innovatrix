import type { Metadata } from "next";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { formatDateTime } from "@/lib/dates";
import type { VendorAccountType, VendorDocumentKind } from "@/lib/db/enums";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { isRemovable, listDocuments } from "@/services/vendors/document-service";
import { AccountTypePicker } from "@/features/vendors/components/account-type-picker";
import { DocumentUpload } from "@/features/vendors/components/document-upload";
import {
  RequirementList,
  SubmitLevel,
  type Requirement,
} from "@/features/vendors/components/requirement-list";

export const metadata: Metadata = { title: "Verification" };

/**
 * Vendor verification — vendor ticket 02, revisited.
 *
 * Two levels, and the ordering is the point: **identity** unlocks listing a
 * product, **payout details** unlock being paid. A vendor may therefore sell
 * before the second completes — earnings accrue in the ledger and are simply not
 * payable. That removes the slowest step from the path to a first listing without
 * ever letting money leave to an unverified account.
 *
 * ## The account type decides what the second level asks for
 *
 * A sole trader has no certificate of incorporation, and a screen that asks for
 * one tells them they are in the wrong place. So the vendor says which they are
 * first, and the second level's document list follows from the answer.
 *
 * **It does not remove the second level.** `payout-service.ts` still requires it
 * approved before money moves, for everybody. An individual is exempt from being
 * asked for a company number, not from proving where their money is going —
 * those are different exemptions and only one of them is safe to grant.
 *
 * ## What is asked for is stated, not implied
 *
 * The screen used to say "a government ID, and something showing the address you
 * gave us", which is a description of a category rather than an instruction. Each
 * level now lists the documents it will accept, by name, so somebody can go and
 * find them without guessing what counts.
 *
 * The guard is awaited in this component's own body before any JSX is returned,
 * and the document read is fast enough not to need a boundary. If it ever does,
 * the guard stays here and the query moves inside `<Suspense>` — never the other
 * way round.
 */
export default async function Page() {
  const { vendor, vendorId } = await requireVendorOrForbid();
  const documents = await listDocuments(vendorId);

  const accountType = vendor.accountType;
  const payoutApproved = vendor.verification.business.status === "approved";
  const waivers = vendor.verificationWaivers ?? [];

  /**
   * The note from the most recent rejection of a level.
   *
   * `verificationDecisions` is append-only, so the last matching entry is the
   * live one. Scanning from the end rather than filtering the whole array is not
   * an optimisation — it is what makes "most recent" true without depending on
   * `at` being set, which it is, but which nothing enforces.
   */
  const rejectionNote = (level: "identity" | "business"): string | undefined => {
    for (let index = vendor.verificationDecisions.length - 1; index >= 0; index -= 1) {
      const decision = vendor.verificationDecisions[index];
      if (decision?.level !== level) continue;
      return decision.outcome === "rejected" ? decision.note : undefined;
    }
    return undefined;
  };

  const forLevel = (level: "identity" | "business") =>
    documents
      .filter((document) => document.level === level)
      .map((document) => ({
        id: String(document._id),
        level: document.level,
        kind: document.kind,
        filename: document.filename,
        sizeBytes: document.sizeBytes,
        uploadedAt: formatDateTime(document.uploadedAt),
        // Decided here, on the server, where the level's status and the date of
        // the last decision both are — see `isRemovable`.
        removable: isRemovable(document, vendor.verification[level]),
      }));

  return (
    <div className="flex max-w-2xl flex-col gap-9">
      <PageHeader
        title="Verification"
        description="Two checks. The first lets you list a product; the second lets us send you money."
        breadcrumbs={[
          { label: "Selling", href: "/dashboard/selling" },
          { label: "Verification" },
        ]}
      />

      <section className="flex flex-col gap-3">
        <Heading
          step="01"
          title="Who is selling"
          purpose="Decides what we need for your payout details."
        />
        <AccountTypePicker
          {...(accountType ? { current: accountType } : {})}
          locked={payoutApproved}
        />
      </section>

      <Level
        step="02"
        title="Identity"
        purpose="Unlocks listing a product. Usually decided within a working day."
        status={vendor.verification.identity.status}
        {...(vendor.verification.identity.decidedAt
          ? { decidedAt: vendor.verification.identity.decidedAt }
          : {})}
        {...(rejectionNote("identity") ? { rejectionNote: rejectionNote("identity") } : {})}
        requirements={toRequirements(
          IDENTITY_REQUIREMENTS,
          "identity",
          forLevel("identity"),
          waivers,
        )}
        documents={forLevel("identity")}
        kinds={["government_id", "proof_of_address", "other"]}
        level="identity"
      />

      <Level
        step="03"
        title="Payout details"
        purpose="Unlocks being paid. You can sell and earn before this is done — the money waits in your balance."
        status={vendor.verification.business.status}
        {...(vendor.verification.business.decidedAt
          ? { decidedAt: vendor.verification.business.decidedAt }
          : {})}
        {...(rejectionNote("business") ? { rejectionNote: rejectionNote("business") } : {})}
        requirements={
          accountType
            ? toRequirements(
                payoutRequirements(accountType),
                "business",
                forLevel("business"),
                waivers,
              )
            : []
        }
        documents={forLevel("business")}
        kinds={
          accountType === "individual"
            ? ["bank_proof", "tax_document", "other"]
            : ["company_registration", "tax_document", "bank_proof", "other"]
        }
        level="business"
        blocked={
          accountType
            ? undefined
            : "Tell us who is selling first — what we need here depends on the answer."
        }
      />

      <div className="border-border flex gap-3 border-t pt-5">
        <ShieldCheck className="text-subtle mt-0.5 size-4 shrink-0" aria-hidden />
        {/*
          Rewritten because the old text was a promise the platform had stopped
          keeping — and should never have made.

          It said the documents were deleted once a level was decided. They are
          not: the identity evidence behind a payout has to be retained to satisfy
          anti-money-laundering rules, and `decideVerificationAction` sets out
          why. A privacy claim that is false is worse than no claim at all, so
          what is left is what is actually true — a purpose, a boundary, a named
          reader, and a limit.
        */}
        <div className="text-subtle flex flex-col gap-2 text-[12.5px] leading-relaxed">
          <p>
            We keep these documents for as long as the law requires us to — the rules that
            govern paying people (anti-money-laundering and know-your-customer) oblige us to
            retain the evidence behind a payout, and both the GDPR and the NDPR allow it on
            exactly that ground. We do not keep them for anything else, and we do not keep them
            indefinitely.
          </p>
          <p>
            Only staff holding the verification permission can open one, every time somebody
            does it is recorded against their name, and the file itself is never served from a
            guessable address. You can ask us what we hold about you, and ask us to erase it
            once we are no longer required to keep it.
          </p>
        </div>
      </div>
    </div>
  );
}

interface RequirementSpec {
  kind: VendorDocumentKind;
  title: string;
  detail: string;
  waivable?: boolean;
}

const IDENTITY_REQUIREMENTS: readonly RequirementSpec[] = [
  {
    kind: "government_id",
    title: "Photo ID",
    detail:
      "A passport, driving licence or national ID card. The photo page in full, with all four edges visible.",
  },
  {
    kind: "proof_of_address",
    title: "Proof of address",
    detail:
      "A bank statement, utility bill or council tax letter from the last three months, showing the address on your application.",
  },
];

/**
 * What the payout level asks for, by account type.
 *
 * The company registration is simply absent for an individual rather than
 * present-and-waivable: offering somebody the chance to declare a document they
 * could never have "not applicable" still tells them it was expected of them.
 *
 * The tax reference is waivable for both. A sole trader below the registration
 * threshold has no reference, and a company that is not VAT registered has no VAT
 * number — in both cases the honest answer is a declaration, not a blank.
 */
function payoutRequirements(accountType: VendorAccountType): readonly RequirementSpec[] {
  const bank: RequirementSpec = {
    kind: "bank_proof",
    title: "Proof of the payout account",
    detail:
      accountType === "individual"
        ? "A bank statement or a screenshot from your banking app showing your name, the account number and the sort code."
        : "A statement showing the account is in the company's name, not a director's.",
  };

  const tax: RequirementSpec = {
    kind: "tax_document",
    title: "Tax reference",
    detail:
      accountType === "individual"
        ? "A UTR, TIN or the equivalent where you live."
        : "The company's VAT number, TIN, or the equivalent where it is registered.",
    waivable: true,
  };

  if (accountType === "individual") return [bank, tax];

  return [
    {
      kind: "company_registration",
      title: "Company registration",
      detail:
        "The certificate of incorporation, or the registry entry showing the company number.",
    },
    tax,
    bank,
  ];
}

/** Fold the spec together with what has actually been sent or waived. */
function toRequirements(
  specs: readonly RequirementSpec[],
  level: "identity" | "business",
  documents: ReadonlyArray<{ kind: string }>,
  waivers: readonly string[],
): Requirement[] {
  return specs.map((spec) => ({
    ...spec,
    provided: documents.some((document) => document.kind === spec.kind),
    waived: waivers.includes(`${level}.${spec.kind}`),
  }));
}

function Heading({
  step,
  title,
  purpose,
  status,
  label,
}: {
  step: string;
  title: string;
  purpose: string;
  status?: string;
  /** Overrides the badge's own wording — see `badgeLabel`. */
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="flex items-baseline gap-3">
        <span className="text-subtle font-mono text-[10px] tracking-[0.2em]">{step}</span>
        <div>
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">{title}</h2>
          <p className="text-muted-foreground mt-0.5 max-w-[54ch] text-[13px] leading-relaxed">
            {purpose}
          </p>
        </div>
      </div>
      {status && <StatusBadge status={status} {...(label ? { label } : {})} />}
    </div>
  );
}

/**
 * The badge label, in this screen's vocabulary.
 *
 * `pending` is shared with payments, plugin handovers and half a dozen other
 * machines, where "Pending" is exactly right. Here it means "we have it and a
 * person has not looked yet", and "Pending" reads to the vendor as *they* are
 * pending — as though something is still expected of them. `StatusBadge` takes a
 * label override for precisely this, so the enum, its tone and every other
 * screen are untouched.
 *
 * `unstarted` splits three ways, because "Not started" is wrong the moment the
 * first document lands and wrong again once the last requirement is settled.
 */
function badgeLabel(status: string, requirements: readonly Requirement[]): string | undefined {
  if (status === "pending") return "Awaiting review";
  // "Rejected" reads as final, and this one is not — the level has been handed
  // back with a note and the vendor can fix it and send it again.
  if (status === "rejected") return "Needs changes";
  if (status !== "unstarted") return undefined;

  if (requirements.length === 0) return undefined;
  if (requirements.every((item) => item.provided || item.waived)) return "Ready to send";
  if (requirements.some((item) => item.provided || item.waived)) return "In progress";
  return undefined;
}

function Level({
  step,
  title,
  purpose,
  status,
  decidedAt,
  rejectionNote,
  requirements,
  documents,
  kinds,
  level,
  blocked,
}: {
  step: string;
  title: string;
  purpose: string;
  status: string;
  decidedAt?: Date;
  /**
   * The reviewer's note from the most recent rejection of this level.
   *
   * Read from `verificationDecisions`, which is appended to and never replaced —
   * so the *last* rejection is the current one, and an older note from a level
   * that has since been fixed and rejected again must not be the one shown.
   */
  rejectionNote?: string;
  /** What this level needs, folded together with what has been sent or waived. */
  requirements: Requirement[];
  documents: React.ComponentProps<typeof DocumentUpload>["documents"];
  kinds: React.ComponentProps<typeof DocumentUpload>["kinds"];
  level: "identity" | "business";
  /** Set when an earlier answer is missing — explains rather than hides. */
  blocked?: string;
}) {
  // An approved level is finished: re-uploading would create documents nobody
  // will read and reopen a decision that has already been made. Re-verification
  // is triggered by a change of circumstance, not by the vendor's upload button
  // (vendor ticket 02).
  const canUpload = status === "unstarted" || status === "rejected";

  return (
    <section className="flex flex-col gap-3">
      <Heading
        step={step}
        title={title}
        purpose={purpose}
        status={status}
        {...(badgeLabel(status, requirements)
          ? { label: badgeLabel(status, requirements) }
          : {})}
      />

      {status === "approved" ? (
        <p className="border-border bg-surface-muted/40 flex items-center gap-2 rounded-xl border px-4 py-3 text-[13px]">
          <CheckCircle2 className="size-4 shrink-0 text-[var(--signal-text)]" aria-hidden />
          Approved{decidedAt ? ` on ${formatDateTime(decidedAt)}` : ""}.
        </p>
      ) : blocked ? (
        <p className="border-border text-muted-foreground rounded-xl border border-dashed px-4 py-3 text-[13px]">
          {blocked}
        </p>
      ) : status === "pending" ? (
        /*
          The confirmation, and the reason this screen needed a submit button at
          all. Until now a vendor who had sent everything saw the same upload box
          as a vendor who had sent nothing, and had to infer from silence that it
          had worked. This says the three things somebody wants at that moment:
          we have it, nothing is expected of you, and here is how you find out.
        */
        <div className="flex flex-col gap-3">
          <div className="border-border bg-surface-muted/40 flex gap-3 rounded-xl border p-4">
            <CheckCircle2
              className="mt-0.5 size-4 shrink-0 text-[var(--signal-text)]"
              aria-hidden
            />
            <div className="flex flex-col gap-1.5">
              <p className="text-[13.5px] font-medium">Documents Sent</p>
              <p className="text-muted-foreground text-[13px] leading-relaxed">
                Somebody checks usually within a working day, and we&rsquo;ll email you as soon
                as there&rsquo;s an answer — whichever way it goes. If we need anything else,
                we&rsquo;ll ask in that email.
              </p>
            </div>
          </div>

          <RequirementList level={level} requirements={requirements} editable={false} />
          <DocumentList documents={documents} />
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {/*
            The reviewer's own words, on the screen where the fix happens.

            This used to say "check the email we sent" — which asks somebody to go
            and find a message in order to act on the page they are already
            looking at, and fails entirely if the email bounced, went to spam, or
            was read on a phone that is not the device they came back on. The note
            is stored on the decision (`decideVerification` refuses a rejection
            without one), so there is no reason to make them fetch it.

            Verbatim, and not paraphrased into the surrounding copy: it is the
            only account of what is wrong, and a second version of it here would
            eventually disagree with the one in the inbox.
          */}
          {status === "rejected" && (
            <div className="border-destructive/40 flex flex-col gap-2 rounded-xl border px-4 py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium">
                  We need something else before this can be approved
                </span>
                {decidedAt && (
                  <span className="text-subtle shrink-0 font-mono text-[11px]">
                    {formatDateTime(decidedAt)}
                  </span>
                )}
              </div>

              {rejectionNote ? (
                <p className="text-[13px] leading-relaxed whitespace-pre-line">
                  {rejectionNote}
                </p>
              ) : (
                <p className="text-muted-foreground text-[13px] leading-relaxed">
                  No reason was recorded, which should not happen — get in touch and we&rsquo;ll
                  explain.
                </p>
              )}

              <p className="text-muted-foreground text-[12.5px]">
                Send what it asks for below and hand it back. Replacing a document does not
                start your application again.
              </p>
            </div>
          )}

          {/* What is needed, how to send it, then hand it over — see `SubmitLevel`. */}
          <RequirementList level={level} requirements={requirements} editable />

          <DocumentUpload
            level={level}
            documents={documents}
            canUpload={canUpload}
            kinds={kinds}
          />

          <SubmitLevel level={level} requirements={requirements} />
        </div>
      )}
    </section>
  );
}

/**
 * What was sent, once sending is over.
 *
 * `DocumentUpload` renders this list *and* an uploader; after submission the
 * uploader would be a control that cannot do anything, so the list is shown on
 * its own. Each row still links to `/api/vendor-documents/[id]`, which a vendor
 * may now open for their own documents.
 */
function DocumentList({
  documents,
}: {
  documents: React.ComponentProps<typeof DocumentUpload>["documents"];
}) {
  if (documents.length === 0) return null;

  return (
    <ul className="border-border divide-border divide-y rounded-xl border text-[13px]">
      {documents.map((document) => (
        <li key={document.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
          <a
            href={`/api/vendor-documents/${document.id}`}
            target="_blank"
            rel="noopener"
            className="truncate underline underline-offset-4"
          >
            {document.filename}
          </a>
          <span className="text-subtle shrink-0 font-mono text-[11px]">
            {document.uploadedAt}
          </span>
        </li>
      ))}
    </ul>
  );
}
