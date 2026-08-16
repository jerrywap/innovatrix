import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth/auth";

/**
 * Better Auth's own endpoints — sign-in, sign-out, callbacks, verification,
 * organization management. Everything under `/api/auth/*`.
 *
 * `getAuth()` is called per request rather than at module scope so that
 * `next build` can import this file without a runtime environment — see the
 * note in `auth.ts`.
 *
 * ## Why there is no route segment config here
 *
 * This file used to export `runtime = "nodejs"` and `dynamic = "force-dynamic"`.
 * Cache Components rejects both, and in each case because it has made the
 * export redundant rather than because the intent was wrong:
 *
 * - **`runtime`** — Cache Components requires the Node.js runtime outright, so
 *   there is no Edge variant left to guard against. The MongoDB driver and
 *   scrypt password hashing still need Node; they simply get it by default now.
 * - **`dynamic`** — under Cache Components a `GET` handler follows the same
 *   model as a page: it is dynamic unless something in it opts into caching
 *   with `use cache`. Nothing here does, and nothing here ever should, so the
 *   handler stays per-request exactly as `force-dynamic` made it.
 *
 * Auth responses must never be cached or prerendered. That is now a property of
 * what this file does, not of a config line that could be deleted by accident.
 */

export const { GET, POST } = toNextJsHandler((request: Request) => getAuth().handler(request));
