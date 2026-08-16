"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, BookmarkCheck } from "lucide-react";
import { toggleSavedAction } from "@/features/marketplace/actions";

/**
 * Save for Later — §8's fourth CTA.
 *
 * A client island because the button's own label changes on click, and a full
 * round trip to flip one word is the kind of thing that makes a page feel slow
 * for no reason.
 *
 * ## Optimistic, but it reverts
 *
 * The state flips immediately and rolls back if the action refuses. The most
 * common refusal is "not signed in", and that is handled by sending them to
 * login with a return path rather than by showing an error — being told to sign
 * in and then landing somewhere else is the annoyance this avoids.
 */
export function SaveButton({
  productId,
  slug,
  initiallySaved,
  signedIn,
}: {
  productId: string;
  slug: string;
  initiallySaved: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initiallySaved);
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={saved}
      onClick={() => {
        if (!signedIn) {
          router.push(`/login?next=/marketplace/${slug}`);
          return;
        }

        const previous = saved;
        setSaved(!previous);

        startTransition(async () => {
          const result = await toggleSavedAction(productId);
          if (!result.ok) setSaved(previous);
          else setSaved(result.data.saved);
        });
      }}
      className="border-border hover:bg-surface-muted flex items-center justify-center gap-2 rounded-full border px-4 py-2.5 text-[13.5px] font-medium transition disabled:opacity-60"
    >
      {saved ? (
        <BookmarkCheck className="size-4 text-[var(--signal)]" aria-hidden />
      ) : (
        <Bookmark className="size-4" aria-hidden />
      )}
      {saved ? "Saved" : "Save for later"}
    </button>
  );
}
