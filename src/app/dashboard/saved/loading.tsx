import { PageSkeleton } from "@/components/shell/page-skeleton";

/**
 * Safe here, and only here-ish — see `loading-boundaries.test.ts`.
 *
 * This segment's page cannot call `forbidden()` or `notFound()`, so there is no
 * status for a streamed shell to get wrong. A `loading.tsx` above a page that
 * *can* refuse commits a 200 before the refusal is known, and the visitor gets
 * the 403 body under a success status.
 */
export default function Loading() {
  return <PageSkeleton />;
}
