"use client";

import { SegmentError } from "@/components/shell/segment-error";

/**
 * Catches errors thrown by the **pages** in this segment — including the
 * `requirePermission()` refusal each one begins with. It cannot catch the
 * layout's own guard, which is why that one redirects instead (see `dal.ts`).
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <SegmentError error={error} reset={reset} homeHref="/admin" homeLabel="Back to admin" />
  );
}
