"use client";

import Link from "next/link";
import type { Route } from "next";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

/**
 * The error boundary body for a shell segment.
 *
 * It exists to separate two failures that look identical to a user and are
 * completely different to us:
 *
 * - **A refusal.** They asked for something they aren't allowed. Nothing is
 *   broken; saying "something went wrong" would send them to support over a
 *   permission they were never given.
 * - **A fault.** Something actually failed, and "try again" is real advice.
 *
 * Telling them apart in the browser is the awkward part: in production Next.js
 * strips the message and leaves only `digest`, so the class name is gone by the
 * time this renders. `ForbiddenError` messages are written to be safe to show,
 * and `withAction` already redacts anything else — so the check is on the
 * message text, and anything unrecognised falls back to the generic fault.
 */
export function SegmentError({
  error,
  reset,
  homeHref,
  homeLabel,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  homeHref: Route;
  homeLabel: string;
}) {
  const refused = /permission|access|staff account|don’t have|do not have/i.test(
    error.message ?? "",
  );

  if (refused) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="You don’t have access to this"
        description={error.message}
        action={
          <Button asChild variant="outline">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      icon={TriangleAlert}
      title="Something went wrong"
      description="That didn’t load. Trying again usually works."
      action={
        <div className="flex gap-2">
          <Button onClick={reset}>Try again</Button>
          <Button asChild variant="outline">
            <Link href={homeHref}>{homeLabel}</Link>
          </Button>
        </div>
      }
    />
  );
}
