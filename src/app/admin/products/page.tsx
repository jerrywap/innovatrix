import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import type { Route } from "next";
import { Package, Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { MoneyDisplay } from "@/components/money-display";
import { PageHeader } from "@/components/page-header";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { can, requirePermissionOrForbid } from "@/lib/auth/dal";
import { connectToDatabase } from "@/lib/db/client";
import { PRODUCT_STATUSES, type ProductStatus } from "@/lib/db/enums";
import { fromDocument } from "@/lib/money";
import { listHref, parseListParams, type RawSearchParams } from "@/lib/list-params";
import { products } from "@/repositories/product.repository";
import { readinessForMany } from "@/services/catalog/product-service";
import { toAdminProductRow, type AdminProductRow } from "@/services/catalog/product-view";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";
import type { Readiness } from "@/services/catalog/readiness";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Products" };

const PATHNAME = "/admin/products" as Route;

/**
 * The catalogue, for an administrator — §41.
 *
 * The page itself renders a static shell; the table is behind `<Suspense>` and
 * receives the `searchParams` promise unawaited. Under Cache Components,
 * awaiting it at the top would make the whole route block instead of streaming.
 */
export default async function AdminProductsPage({
  searchParams,
}: PageProps<"/admin/products">) {
  await requirePermissionOrForbid("product.update");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="Everything in the catalogue, and what is stopping each draft going live."
        actions={<NewProductButton />}
      />

      <Suspense fallback={<PageSkeleton rows={6} />}>
        <ProductTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewProductButton() {
  // `product.create` is a different permission from `product.update` — a
  // `content_manager` edits the catalogue but does not add to it.
  if (!(await can("product.create"))) return null;

  return (
    <Button asChild>
      <Link href="/admin/products/new">
        <Plus className="size-4" aria-hidden />
        New product
      </Link>
    </Button>
  );
}

async function ProductTable({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const raw = await searchParams;

  const params = parseListParams(raw, {
    defaultLimit: 25,
    sortable: ["updatedAt", "name", "orderCount"],
    defaultSort: "updatedAt",
    // Vendor ticket 04. `vendor` here is a **slug**, not an id, and it is a staff
    // screen — staff read across every vendor by design, so this is a convenience
    // filter rather than a scope. A vendor's *own* list takes its scope from the
    // session and deliberately has no such key.
    filterable: ["status", "vendor"],
  });

  await connectToDatabase();

  const status = params.filters.status;
  const vendorSlug = params.filters.vendor;
  const page = await products.list({
    filter: {
      ...(status && isProductStatus(status) ? { status } : {}),
      ...(vendorSlug ? { vendorSlug } : {}),
      ...(params.q ? { $text: { $search: params.q } } : {}),
    },
    sort: params.sort ? { [params.sort]: params.direction === "asc" ? 1 : -1 } : undefined,
    page: params.page,
    limit: params.limit,
  });

  // Two queries for the whole page, not two per row.
  const readiness = await readinessForMany(page.items);
  const rows = page.items.map(toAdminProductRow);

  return (
    <div className="flex flex-col gap-4">
      <StatusFilter current={status} raw={raw} counts={page.total} />

      <DataTable
        rows={rows}
        columns={columns(readiness)}
        rowKey={(row) => row.id}
        rowHref={(row) => `/admin/products/${row.id}/basics` as Route}
        params={params}
        searchParams={raw}
        pathname={PATHNAME}
        total={page.total}
        empty={
          <EmptyState
            icon={Package}
            title={status || params.q ? "No products match" : "No products yet"}
            description={
              status || params.q
                ? "Try a different status, or clear the search."
                : "Create one to start building the catalogue."
            }
            variant={status || params.q ? "no-results" : "empty"}
          />
        }
      />
    </div>
  );
}

function columns(readiness: Map<string, Readiness>): Array<Column<AdminProductRow>> {
  return [
    {
      key: "name",
      header: "Product",
      sortable: true,
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium">{row.name}</span>
          <code className="text-subtle font-mono text-[11.5px]">{row.slug}</code>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "vendorName",
      header: "Seller",
      secondary: true,
      // "Innovatrix" rather than a dash for a first-party product: on this screen the
      // distinction between "we sell this" and "somebody else does" is the point, and
      // an empty cell reads as missing data.
      cell: (row) => (
        <span className="text-muted-foreground text-[12.5px]">
          {row.vendorName ?? "Innovatrix"}
        </span>
      ),
    },
    {
      key: "readiness",
      header: "Blocking publish",
      secondary: true,
      cell: (row) => {
        // Already live — "ready to publish" would be a strange thing to say.
        if (row.status === "published") {
          return <span className="text-subtle text-[12.5px]">—</span>;
        }
        const result = readiness.get(row.id);
        return result ? <ReadinessGaps gaps={result.gaps} productId={row.id} compact /> : null;
      },
    },
    {
      key: "primaryPrice",
      header: "Price",
      align: "right",
      secondary: true,
      cell: (row) => (
        <MoneyDisplay
          value={row.primaryPrice ? fromDocument(row.primaryPrice) : null}
          compact
          placeholder="—"
        />
      ),
    },
    {
      key: "orderCount",
      header: "Orders",
      align: "right",
      sortable: true,
      secondary: true,
      cell: (row) => <span className="tabular-nums">{row.orderCount}</span>,
    },
  ];
}

/**
 * Status filter as links, not a `<select>`.
 *
 * Keeps the whole screen a Server Component and makes each filter a shareable
 * URL, per the URL-state convention.
 */
function StatusFilter({
  current,
  raw,
  counts,
}: {
  current?: string;
  raw: RawSearchParams;
  counts: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <FilterChip href={listHref(PATHNAME, raw, { status: undefined })} active={!current}>
        All
        <span className="text-subtle ml-1.5 tabular-nums">{!current ? counts : ""}</span>
      </FilterChip>

      {PRODUCT_STATUSES.map((status) => (
        <FilterChip
          key={status}
          href={listHref(PATHNAME, raw, { status })}
          active={current === status}
        >
          {status.replace(/_/g, " ")}
        </FilterChip>
      ))}
    </div>
  );
}

function FilterChip({
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
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[12.5px] font-medium capitalize transition",
        active
          ? "border-signal/30 bg-signal-soft text-signal-text"
          : "border-border text-muted-foreground hover:bg-surface-muted hover:text-foreground",
      )}
    >
      {children}
    </Link>
  );
}

function isProductStatus(value: string): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly string[]).includes(value);
}
