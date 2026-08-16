import type { Route } from "next";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { listHref, type ListParams, type RawSearchParams } from "@/lib/list-params";
import { EmptyState } from "./empty-state";

/**
 * The list table.
 *
 * A **Server Component**, deliberately. Sorting and paging are links, not
 * click handlers, so a table renders and works before any JavaScript arrives —
 * and the state it shows is the state in the URL, which is the ticket-04
 * convention. `@tanstack/react-table` is the thing this replaces: it is a fine
 * library and it would move all of this into the client for no gain, because
 * the data comes from MongoDB a page at a time anyway.
 *
 * Wide tables scroll inside their own container rather than pushing the page
 * sideways.
 */

export interface Column<Row> {
  key: string;
  header: string;
  /** Renders the cell. Keep it presentational — no data fetching in here. */
  cell: (row: Row) => React.ReactNode;
  /** Only if the backing query can actually sort by it. */
  sortable?: boolean;
  /** Numbers right-align; the eye compares magnitudes on a shared edge. */
  align?: "left" | "right";
  /** Hidden below `sm`. Use for anything that isn't identifying. */
  secondary?: boolean;
  width?: string;
}

export interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: ReadonlyArray<Column<Row>>;
  rowKey: (row: Row) => string;
  /** Makes the whole row a link. Far better than a trailing "view" column. */
  rowHref?: (row: Row) => Route;
  params: ListParams;
  searchParams: RawSearchParams;
  pathname: Route;
  /** Total matching rows, for the pager. Omit if genuinely unknown. */
  total?: number;
  empty?: React.ReactNode;
  className?: string;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  rowHref,
  params,
  searchParams,
  pathname,
  total,
  empty,
  className,
}: DataTableProps<Row>) {
  if (rows.length === 0) {
    return (
      <>
        {empty ?? (
          <EmptyState
            title={
              params.q || Object.keys(params.filters).length > 0
                ? "No matches"
                : "Nothing here yet"
            }
            variant={
              params.q || Object.keys(params.filters).length > 0 ? "no-results" : "empty"
            }
          />
        )}
      </>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="border-border bg-surface overflow-x-auto rounded-xl border">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-border border-b">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    "text-muted-foreground px-3.5 py-2.5 text-left font-medium whitespace-nowrap",
                    column.align === "right" && "text-right",
                    column.secondary && "hidden sm:table-cell",
                  )}
                  aria-sort={ariaSort(column, params)}
                >
                  {column.sortable ? (
                    <SortLink
                      column={column}
                      params={params}
                      searchParams={searchParams}
                      pathname={pathname}
                    />
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr
                  key={rowKey(row)}
                  className={cn(
                    "border-border border-b last:border-0",
                    href && "hover:bg-surface-muted/60 transition",
                  )}
                >
                  {columns.map((column, columnIndex) => (
                    <td
                      key={column.key}
                      className={cn(
                        "px-3.5 py-3 align-middle",
                        column.align === "right" && "text-right",
                        column.secondary && "hidden sm:table-cell",
                      )}
                    >
                      {/* The link wraps the first cell's content and is
                          stretched across the row, so the whole row is a hit
                          target without nesting a link inside every cell —
                          which would break keyboard navigation by giving one
                          row a dozen tab stops. */}
                      {href && columnIndex === 0 ? (
                        <Link href={href} className="relative after:absolute after:inset-0">
                          {column.cell(row)}
                        </Link>
                      ) : (
                        column.cell(row)
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pager
        params={params}
        searchParams={searchParams}
        pathname={pathname}
        rowCount={rows.length}
        {...(total !== undefined ? { total } : {})}
      />
    </div>
  );
}

function ariaSort<Row>(
  column: Column<Row>,
  params: ListParams,
): "ascending" | "descending" | "none" | undefined {
  if (!column.sortable) return undefined;
  if (params.sort !== column.key) return "none";
  return params.direction === "asc" ? "ascending" : "descending";
}

function SortLink<Row>({
  column,
  params,
  searchParams,
  pathname,
}: {
  column: Column<Row>;
  params: ListParams;
  searchParams: RawSearchParams;
  pathname: Route;
}) {
  const isActive = params.sort === column.key;
  // Clicking the active column flips direction; a new column starts descending,
  // which is what "most recent first" means for nearly every list here.
  const nextDirection = isActive && params.direction === "desc" ? "asc" : "desc";

  return (
    <Link
      href={listHref(pathname, searchParams, { sort: column.key, direction: nextDirection })}
      className="hover:text-foreground inline-flex items-center gap-1 transition"
    >
      {column.header}
      {isActive &&
        (params.direction === "asc" ? (
          <ArrowUp className="size-3" aria-hidden />
        ) : (
          <ArrowDown className="size-3" aria-hidden />
        ))}
    </Link>
  );
}

function Pager({
  params,
  searchParams,
  pathname,
  rowCount,
  total,
}: {
  params: ListParams;
  searchParams: RawSearchParams;
  pathname: Route;
  rowCount: number;
  total?: number;
}) {
  const from = (params.page - 1) * params.limit + 1;
  const to = from + rowCount - 1;
  // Without a total, "is there a next page?" is answered by whether this page
  // came back full — one fewer count query on every list render.
  const hasNext = total !== undefined ? to < total : rowCount === params.limit;
  const hasPrevious = params.page > 1;

  if (!hasNext && !hasPrevious) {
    return (
      <p className="text-subtle text-[12.5px]">
        {rowCount} {rowCount === 1 ? "result" : "results"}
      </p>
    );
  }

  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-subtle text-[12.5px]">
        {from}–{to}
        {total !== undefined && <> of {total}</>}
      </p>

      <div className="flex items-center gap-1.5">
        <PagerLink
          href={listHref(pathname, searchParams, { page: params.page - 1 })}
          disabled={!hasPrevious}
          label="Previous page"
        >
          <ChevronLeft className="size-4" aria-hidden />
        </PagerLink>
        <PagerLink
          href={listHref(pathname, searchParams, { page: params.page + 1 })}
          disabled={!hasNext}
          label="Next page"
        >
          <ChevronRight className="size-4" aria-hidden />
        </PagerLink>
      </div>
    </div>
  );
}

function PagerLink({
  href,
  disabled,
  label,
  children,
}: {
  href: Route;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  // A disabled control must not be a link — a real <a> stays focusable and
  // clickable however it is styled.
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        aria-label={label}
        className="border-border text-subtle grid size-8 place-items-center rounded-lg border opacity-40"
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className="border-border hover:bg-surface-muted grid size-8 place-items-center rounded-lg border transition"
    >
      {children}
    </Link>
  );
}
