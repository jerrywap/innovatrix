import "server-only";
import { toObjectId } from "@/lib/db/base";

/**
 * Turning a viewer's scope into a query filter — §88, ticket 26.
 *
 * ## The bug this exists to make impossible
 *
 * Three loaders were written as:
 *
 * ```ts
 * ...(scope.organizationId ? { organizationId: toObjectId(scope.organizationId) } : {})
 * ```
 *
 * which is correct for the two cases anybody thinks about — a customer passes
 * their organisation and is scoped, staff pass nothing and see everything (§30)
 * — and silently wrong for the third. An **empty string is falsy**, so
 * `organizationId: value ?? ""` or a blank form field does not narrow the query
 * to nothing; it removes the filter entirely and returns another organisation's
 * invoice. The widening is invisible at the call site and the code reads as
 * though it were scoped.
 *
 * Found by writing a tenant-isolation test that asserted the empty-string case
 * and noticing the assertion had to be "returns the record" for the test to
 * pass.
 *
 * So: **staff scope is `undefined`, and nothing else is.** Anything present but
 * empty is a caller bug and throws rather than quietly becoming god mode.
 */

export interface OrgScope {
  /**
   * Absent ⇒ across all organisations. Only ever omitted deliberately, by a
   * staff-facing caller that has already passed a permission check.
   */
  organizationId?: string;
}

export class ScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopeError";
  }
}

/**
 * `{}` for a staff caller, `{ organizationId }` for a customer, a throw for
 * anything ambiguous.
 */
export function orgFilter(scope: OrgScope): { organizationId?: ReturnType<typeof toObjectId> } {
  if (scope.organizationId === undefined) return {};

  if (scope.organizationId.trim() === "") {
    throw new ScopeError(
      "An empty organizationId is not a scope. Omit the field for an " +
        "across-organisations read; passing a blank string used to widen the " +
        "query to every organisation.",
    );
  }

  return { organizationId: toObjectId(scope.organizationId) };
}

/* ────────────────────────────────────────────── vendors */

export interface VendorScope {
  /**
   * Absent ⇒ across all vendors. Only ever omitted deliberately, by a
   * staff-facing caller that has already passed a permission check.
   */
  vendorId?: string;
}

/**
 * The same shape as `orgFilter`, for the same reason.
 *
 * Written as a sibling rather than a generic over the field name: the value of
 * the original is that its one bug is documented at the top of this file and
 * cannot recur, and a clever abstraction over two callers would put a
 * `field: keyof T` between the reader and that. Two small functions that are
 * obviously correct beat one that has to be reasoned about.
 *
 * Note this is *not* how a vendor's own scope is established — that comes from
 * `requireVendor()`, from the session. This is for the service layer, where a
 * read is either vendor-scoped or deliberately staff-wide.
 */
export function vendorFilter(scope: VendorScope): { vendorId?: ReturnType<typeof toObjectId> } {
  if (scope.vendorId === undefined) return {};

  if (scope.vendorId.trim() === "") {
    throw new ScopeError(
      "An empty vendorId is not a scope. Omit the field for an across-vendors " +
        "read; passing a blank string would widen the query to every vendor.",
    );
  }

  return { vendorId: toObjectId(scope.vendorId) };
}
