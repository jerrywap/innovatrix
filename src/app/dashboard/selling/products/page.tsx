import type { Metadata } from "next";
import Link from "next/link";
import type { Route } from "next";
import { Package, Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/data-table";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/dates";
import { PRODUCT_STATUSES, type ProductStatus } from "@/lib/db/enums";
import { parseListParams } from "@/lib/list-params";
import { requireVendorOrForbid } from "@/lib/auth/dal";
import { listForVendor, readinessForMany } from "@/services/catalog/product-service";
import { toAdminProductRow, type AdminProductRow } from "@/services/catalog/product-view";
import type { Readiness } from "@/services/catalog/readiness";
import { ReadinessGaps } from "@/features/products/components/readiness-gaps";

export const metadata: Metadata = { title: "Your products" };

const PATHNAME = "/dashboard/selling/products";

/**
 * A vendor's own products — vendor ticket 04.
 *
 * ## The scope is not a filter
 *
 * `parseListParams` declares `filterable: ["status"]` and **not** `vendorId`. That is
 * the load-bearing line: everything from a query string is untrusted, and a
 * `filterable` entry for the owner would let anybody type another vendor's id into
 * the URL. The scope comes from `requireVendorOrForbid()`, from the session, every
 * time — and `vendorFilter` throws on a blank one rather than widening to every
 * vendor.
 *
 * The guard is awaited in this component's own body before any JSX. There is no
 * `loading.tsx` under `/dashboard/selling` and there must not be: this page refuses,
 * and a boundary above a refusing route commits `200 OK` before the refusal is
 * decided.
 */
export default async function Page({ searchParams }: PageProps<"/dashboard/selling/products">) {
  const { vendorId } = await requireVendorOrForbid();
  const raw = await searchParams;

  const params = parseListParams(raw, {
    defaultLimit: 25,
    sortable: ["updatedAt", "name", "orderCount"],
    defaultSort: "updatedAt",
    filterable: ["status"],
  });

  const status = params.filters.status;
  const page = await listForVendor(
    { vendorId },
    {
      ...(status && isProductStatus(status) ? { status } : {}),
      page: params.page,
      limit: params.limit,
      ...(params.sort
        ? {
            sort: { [params.sort]: params.direction === "asc" ? 1 : -1 } as Record<
              string,
              1 | -1
            >,
          }
        : {}),
    },
  );

  // Two queries for the whole page, not two per row.
  const readiness = await readinessForMany(page.items);
  const rows = page.items.map(toAdminProductRow);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Your products"
        description="Everything you sell here, and what is left to do on each."
        breadcrumbs={[{ label: "Selling", href: "/dashboard/selling" }, { label: "Products" }]}
        actions={
          <Button asChild>
            <Link href="/dashboard/selling/products/new">
              <Plus className="size-4" aria-hidden />
              New product
            </Link>
          </Button>
        }
      />

      <DataTable
        rows={rows}
        columns={columns(readiness)}
        rowKey={(row) => row.id}
        rowHref={(row) => `/dashboard/selling/products/${row.id}/basics` as Route}
        params={params}
        searchParams={raw}
        pathname={PATHNAME}
        total={page.total}
        empty={
          <EmptyState
            icon={Package}
            title={status || params.q ? "No products match" : "Nothing listed yet"}
            description={
              status || params.q
                ? "Try a different status, or clear the search."
                : "Create your first product. A reviewer checks it before it goes on sale."
            }
            variant={status || params.q ? "no-results" : "empty"}
          />
        }
      />
    </div>
  );
}

/**
 * A local type guard, mirroring `/admin/products`.
 *
 * The status arrives from a query string, so it is untrusted: `parseListParams`
 * allow-lists the *key* and this narrows the *value*. Without it a crafted `?status=`
 * would reach the filter as a string Mongo cannot match, which is harmless but reads
 * as an empty list rather than as a bad request.
 */
function isProductStatus(value: string): value is ProductStatus {
  return (PRODUCT_STATUSES as readonly string[]).includes(value);
}

/**
 * The same readiness the submission gate uses.
 *
 * `computeReadiness` is pure and shared, so this column and the refusal cannot
 * disagree about what is missing — the version that says "ready" while the button
 * refuses is the one people trust.
 */
function columns(readiness: Map<string, Readiness>): Array<Column<AdminProductRow>> {
  return [
    {
      key: "name",
      header: "Product",
      sortable: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{row.name}</p>
          <p className="text-subtle truncate font-mono text-[11px]">/{row.slug}</p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => <StatusBadge status={row.status} />,
    },
    {
      key: "readiness",
      header: "Before you submit",
      cell: (row) => (
        <ReadinessGaps
          gaps={readiness.get(row.id)?.gaps ?? []}
          productId={row.id}
          compact
          surface="vendor"
        />
      ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      sortable: true,
      cell: (row) => (
        <span className="text-muted-foreground text-[12.5px]">
          {row.updatedAt ? formatDateTime(row.updatedAt) : "—"}
        </span>
      ),
    },
  ];
}
