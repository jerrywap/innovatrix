import "server-only";
import type { ClientSession } from "mongoose";
import { NotFoundError } from "@/lib/errors";
import type { VendorScope } from "@/lib/auth/scope";
import { products } from "@/repositories/product.repository";
import { productFiles } from "@/repositories/product-file.repository";
import { productVersions } from "@/repositories/product-version.repository";
import type { ProductDoc, ProductFileDoc, ProductVersionDoc } from "@/lib/db/models/catalog";

/**
 * Resolving vendor ownership for things that do not carry a `vendorId` — vendor
 * tickets 04 and 06.
 *
 * ## Why versions and files have no owner field
 *
 * Ownership derives through `productId`, deliberately. Vendor ticket 04 settled it:
 * a second axis on `ProductVersion` and `ProductFile` would be a denormalised copy
 * that can disagree with the product it hangs off, and storage authorisation already
 * works this way — `assertProductFileKey` binds an object to its product, so vendor
 * isolation on storage falls out of product ownership rather than needing its own
 * field.
 *
 * The cost is this module: one extra read per scoped operation on a version or a
 * file. Worth paying, because the alternative is a field that has to be kept in step
 * on every reassignment and whose staleness is invisible.
 *
 * ## Everything here answers 404, never 403
 *
 * A version or file belonging to another vendor is indistinguishable from one that
 * does not exist. Distinguishing them turns the workspace into an oracle for which
 * ids are real, and the platform already takes that position on downloads and on AI
 * conversations.
 *
 * ## An omitted scope is a staff call
 *
 * Every function takes `VendorScope` and `{}` means "across every vendor" — which is
 * correct for staff and has to be *deliberate* at the call site. `vendorFilter`
 * throws on a blank string rather than widening, so `{ vendorId: value ?? "" }`
 * cannot silently become god mode.
 */

/** The product, if this scope may see it. */
export async function requireOwnedProduct(
  productId: string,
  scope: VendorScope,
  options: { session?: ClientSession } = {},
): Promise<ProductDoc> {
  const product = await products.findScoped(productId, scope, options);
  if (!product) throw new NotFoundError("product", { id: productId });
  return product;
}

/**
 * The version, if this scope may see the product it belongs to.
 *
 * Returns both, because every caller needs the version and most need the product's
 * status or vendor for the next decision — and asking twice is the N+1 this module
 * exists to keep to N.
 */
export async function requireOwnedVersion(
  versionId: string,
  scope: VendorScope,
  options: { session?: ClientSession } = {},
): Promise<{ version: ProductVersionDoc; product: ProductDoc }> {
  const version = await productVersions.findById(versionId, options);
  if (!version) throw new NotFoundError("version", { id: versionId });

  const product = await requireOwnedProduct(String(version.productId), scope, options);
  return { version, product };
}

/** The file, if this scope may see the product it belongs to. */
export async function requireOwnedFile(
  fileId: string,
  scope: VendorScope,
  options: { session?: ClientSession } = {},
): Promise<{ file: ProductFileDoc; product: ProductDoc }> {
  const file = await productFiles.findById(fileId, options);
  if (!file) throw new NotFoundError("file", { id: fileId });

  const product = await requireOwnedProduct(String(file.productId), scope, options);
  return { file, product };
}
