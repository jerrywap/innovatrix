/**
 * Repository singletons.
 *
 * One instance per model, created at module scope. A repository holds no
 * request state — it is a named collection of queries over one model — so
 * there is nothing to leak between requests and nothing to construct per call.
 *
 * Repositories do **not** call `connectToDatabase()`. Services do, once, at
 * their entry point — the same convention the DAL follows. Mongoose's
 * `bufferCommands: false` means a query issued before the connection is ready
 * fails fast rather than hanging, so a missing call is loud.
 *
 * Import the specific repository you need rather than this barrel when you only
 * want one; this exists for services that legitimately touch several.
 */
export { auditLogs, AuditLogRepository } from "./audit-log.repository";
export { productFiles, ProductFileRepository } from "./product-file.repository";
export { productVersions, ProductVersionRepository } from "./product-version.repository";
export { products, ProductRepository } from "./product.repository";
export { taxonomies, TaxonomyRepository } from "./taxonomy.repository";
export {
  BaseRepository,
  OrgScopedRepository,
  RepositoryError,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  type ListParams,
  type Paginated,
} from "./base";
