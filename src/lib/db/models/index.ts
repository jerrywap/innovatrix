/**
 * Every collection in the MVP domain model (ticket 02).
 *
 * Importing from here registers the model with Mongoose. Services should import
 * the specific model they need rather than this barrel, so a route handler
 * doesn't drag the whole schema graph into its bundle.
 */
export * from "./identity";
export * from "./vendors";
export * from "./ledger";
export * from "./catalog";
export * from "./commerce";
export * from "./requests";
export * from "./billing";
export * from "./communication";
export * from "./system";
