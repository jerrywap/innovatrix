import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { isReference } from "@/lib/references";
import { ProcessingPoller } from "@/features/checkout/components/processing";

export const metadata: Metadata = {
  title: "Confirming your payment",
  robots: { index: false, follow: false },
};

/**
 * The post-payment landing page — §13, §103.
 *
 * Renders a poller and nothing else. It does not read the order, does not check
 * a query parameter for `?success=true`, and does not assume anything from
 * having been navigated to: the provider's redirect is a browser event, and the
 * webhook is the authority.
 */
export default async function Page({ searchParams }: PageProps<"/checkout/processing">) {
  /*
   * The reference is validated here, not inside the boundary below.
   *
   * `notFound()` sets a 404, and a response whose shell has already streamed is
   * committed at 200 — so validating inside `<Suspense>` served the not-found
   * body under a success status, and a crawler or a monitor was told the page
   * existed. Awaiting `searchParams` costs nothing: the route is already
   * dynamic, and there is no work to stream ahead of knowing which order this
   * is. See `loading-boundaries.test.ts`.
   *
   * It is still validated before the poller sees it, so a malformed reference
   * is a 404 rather than a client component retrying a nonsense lookup every
   * few seconds.
   */
  const params = await searchParams;
  const raw = Array.isArray(params.order) ? params.order[0] : params.order;
  const reference = raw?.trim().toUpperCase();

  if (!reference || !isReference(reference)) notFound();

  return (
    <div className="mx-auto w-full max-w-[900px] px-5 py-16 lg:px-10">
      <Suspense fallback={<Skeleton className="mx-auto h-72 max-w-[520px] rounded-xl" />}>
        <ProcessingPoller reference={reference} />
      </Suspense>
    </div>
  );
}
