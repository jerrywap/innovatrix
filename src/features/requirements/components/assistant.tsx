"use client";

import { useState } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Conversation, type DisplayMessage } from "./conversation";
import { ReviewPanel } from "./review-panel";
import { abandonConversationAction } from "../actions";

/**
 * The interview and the review, side by side — tickets 17 and 18.
 *
 * Both doors render this. What differs is the system prompt and the entry
 * point; the machinery of talking, summarising, editing and submitting is one
 * implementation, because §73's guardrails and §34's confirmed-vs-assumed split
 * must not have two versions that can disagree.
 */
export function Assistant({
  conversationId,
  initialMessages,
  signedIn,
  signInHref,
  suggestions,
  startOverHref,
  submitted,
}: {
  conversationId: string;
  initialMessages: DisplayMessage[];
  signedIn: boolean;
  signInHref: string;
  suggestions?: string[];
  startOverHref: string;
  submitted?: { reference: string };
}) {
  const [messages, setMessages] = useState<DisplayMessage[]>(initialMessages);
  const [restarting, setRestarting] = useState(false);

  if (submitted) {
    return (
      <div className="border-border bg-surface flex flex-col gap-3 rounded-xl border p-5">
        <h2 className="font-display text-[17px] tracking-[-0.02em]">
          Sent — {submitted.reference}
        </h2>
        <p className="text-muted-foreground text-[13.5px]">
          Someone will read it and come back to you. You can follow it from your dashboard.
        </p>
        <Link
          href="/dashboard/requests"
          className="bg-foreground text-background w-fit rounded-full px-4 py-2 text-[13px] font-medium"
        >
          See your requests
        </Link>
      </div>
    );
  }

  // Enough of a conversation to be worth summarising. Two turns is the point at
  // which the customer has actually said something.
  const worthReviewing = messages.filter((message) => message.role === "user").length >= 1;

  return (
    <div className="flex flex-col gap-6">
      <Conversation
        conversationId={conversationId}
        initialMessages={initialMessages}
        onTranscriptChange={setMessages}
        {...(suggestions ? { suggestions } : {})}
      />

      {worthReviewing && (
        <ReviewPanel
          conversationId={conversationId}
          signedIn={signedIn}
          signInHref={signInHref}
        />
      )}

      <div className="flex justify-end">
        <button
          type="button"
          disabled={restarting}
          onClick={async () => {
            setRestarting(true);
            await abandonConversationAction(conversationId);
            // A full navigation: the page starts a fresh conversation server-side,
            // and the abandoned one stays on record (§19) rather than vanishing.
            window.location.href = startOverHref;
          }}
          className="text-subtle hover:text-foreground flex items-center gap-1.5 text-[12.5px]"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Start over
        </button>
      </div>
    </div>
  );
}
