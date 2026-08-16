import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ScrollText } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePermissionOrForbid } from "@/lib/auth/dal";
import { ACTOR_TYPES, SUBJECT_TYPES } from "@/lib/db/enums";
import { listHref, parseListParams, type RawSearchParams } from "@/lib/list-params";
import { listAuditLog, type AuditRow } from "@/features/audit/audit-view";

export const metadata: Metadata = { title: "Audit log" };

const PATHNAME = "/admin/audit" as Route;

/**
 * Who changed what — §90's staff-visible viewer.
 *
 * The collection has been written to since ticket 06 and read by nothing. An
 * audit trail nobody can read is a compliance artefact rather than a tool: the
 * first time it is needed is during an incident, which is the worst moment to
 * discover it needs a mongosh session.
 *
 * Behind `audit.view`, which only `devops` and `super_admin` hold. Deliberately
 * narrow — the log records everyone's actions including staff, and reading it
 * is itself a sensitive capability.
 */
export default async function Page({ searchParams }: PageProps<"/admin/audit">) {
  // Guard before the boundary, so the refusal carries a 403 rather than
  // rendering under the 200 a streamed shell has already committed.
  await requirePermissionOrForbid("audit.view");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Audit log"
        description="Every recorded action, newest first. Append-only — nothing here can be changed."
      />
      <Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
        <Entries searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Entries({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;

  const params = parseListParams(raw, {
    defaultLimit: 50,
    // No `sortable`: this is a log, and the only order that means anything is
    // the one it happened in. Offering "sort by action" would invite reading it
    // in an order that hides the sequence.
    filterable: ["action", "actorType", "subjectType"],
  });

  const page = await listAuditLog(params, {
    ...(params.filters.action ? { action: params.filters.action } : {}),
    ...(isActorType(params.filters.actorType) ? { actorType: params.filters.actorType } : {}),
    ...(isSubjectType(params.filters.subjectType)
      ? { subjectType: params.filters.subjectType }
      : {}),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-6">
        <Facet
          label="Actor"
          values={ACTOR_TYPES}
          current={params.filters.actorType}
          field="actorType"
          raw={raw}
        />
        <Facet
          label="Subject"
          values={SUBJECT_TYPES}
          current={params.filters.subjectType}
          field="subjectType"
          raw={raw}
        />
      </div>

      <DataTable
        rows={page.rows}
        columns={COLUMNS}
        rowKey={(row) => row.id}
        params={params}
        searchParams={raw}
        pathname={PATHNAME}
        total={page.total}
        empty={
          <EmptyState
            icon={ScrollText}
            title="Nothing recorded yet"
            description="Actions that change money, entitlement or configuration are recorded here."
          />
        }
      />
    </div>
  );
}

const COLUMNS: Array<Column<AuditRow>> = [
  {
    key: "at",
    header: "When",
    width: "11rem",
    cell: (row) => <span className="text-subtle font-mono text-[11.5px]">{row.at}</span>,
  },
  {
    key: "action",
    header: "Action",
    cell: (row) => <span className="font-mono text-[12px]">{row.action}</span>,
  },
  {
    key: "actor",
    header: "Who",
    cell: (row) => (
      <div className="flex flex-col">
        <span className="text-[13px]">{row.actorName}</span>
        <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
          {row.actorType}
        </span>
      </div>
    ),
  },
  {
    key: "subject",
    header: "On what",
    secondary: true,
    cell: (row) => (
      <span className="text-muted-foreground font-mono text-[11.5px]">
        {row.subject ?? "—"}
      </span>
    ),
  },
  {
    key: "changed",
    header: "Change",
    secondary: true,
    cell: (row) => (
      <span className="text-muted-foreground text-[12.5px]">{row.changed ?? "—"}</span>
    ),
  },
  {
    key: "ip",
    header: "From",
    secondary: true,
    width: "9rem",
    cell: (row) => <span className="text-subtle font-mono text-[11.5px]">{row.ip ?? "—"}</span>,
  },
];

function Facet({
  label,
  values,
  current,
  field,
  raw,
}: {
  label: string;
  values: readonly string[];
  current?: string;
  field: string;
  raw: RawSearchParams;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-subtle font-mono text-[9.5px] tracking-[0.14em] uppercase">
        {label}
      </span>
      <Chip href={listHref(PATHNAME, raw, { [field]: undefined })} active={!current}>
        Any
      </Chip>
      {values.map((value) => (
        <Chip
          key={value}
          href={listHref(PATHNAME, raw, { [field]: value })}
          active={current === value}
        >
          {value}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
  href,
  active,
  children,
}: {
  href: Route;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      // Filters live in the URL, not in state — so a filtered view is linkable
      // and Back works (AGENTS.md, §94).
      className={
        active
          ? "bg-foreground text-background rounded-full px-2.5 py-1 text-[11.5px]"
          : "border-border hover:bg-surface-muted rounded-full border px-2.5 py-1 text-[11.5px]"
      }
    >
      {children}
    </Link>
  );
}

function isActorType(value: string | undefined): value is (typeof ACTOR_TYPES)[number] {
  return Boolean(value) && (ACTOR_TYPES as readonly string[]).includes(value!);
}

function isSubjectType(value: string | undefined): value is (typeof SUBJECT_TYPES)[number] {
  return Boolean(value) && (SUBJECT_TYPES as readonly string[]).includes(value!);
}
