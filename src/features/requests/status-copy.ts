import type { RequestStatus } from "@/lib/db/enums";

/**
 * §70 in the customer's words, and — the part that matters — *what happens
 * next*. A status alone leaves them guessing whether it is their move.
 *
 * ## Its own module because two surfaces say it
 *
 * `request-view.ts` puts it on the request page, and `request-success.tsx` says
 * it the moment a request is created — the same status, so it must be the same
 * sentence. It lived in `request-view.ts`, which is `server-only`, so the
 * confirmation could not reach it and would have had to restate it. Two copies of
 * a sentence describing a state machine is two copies to keep in step, and the
 * one nobody re-reads is the one that goes stale.
 */
export const REQUEST_STATUS_COPY: Record<RequestStatus, { what: string; next: string }> = {
  draft: {
    what: "You haven't sent this to us yet.",
    next: "Finish it whenever you're ready.",
  },
  submitted: {
    what: "We've got it.",
    next: "Someone will pick it up and read it properly. Nothing needed from you.",
  },
  under_review: {
    what: "Someone is going through it.",
    next: "We'll come back with questions or a quote.",
  },
  waiting_for_customer: {
    what: "We've asked you something.",
    next: "Have a look below — we can't go further until you answer.",
  },
  technical_review: {
    what: "Our technical team is scoping it.",
    next: "They're working out what it takes. A quote follows.",
  },
  quoted: {
    what: "We've sent you a quote.",
    next: "Have a read and let us know either way.",
  },
  approved: {
    what: "You accepted the quote.",
    next: "We'll get the work scheduled and be in touch.",
  },
  converted: {
    // Was "Work has started", which it is not — this state means the money
    // arrived and the job is queued. Saying work had started while it sat in a
    // handover queue is how a customer concludes nobody is doing anything.
    what: "Payment received — this is with our team.",
    next: "We'll confirm when someone picks it up.",
  },
  in_progress: {
    what: "Work has started.",
    next: "We'll post updates here as it moves.",
  },
  delivered: {
    what: "It's ready for you to look at.",
    next: "Have a look and tell us if anything isn't right.",
  },
  completed: {
    what: "All done.",
    next: "Get in touch any time if you need changes or help.",
  },
  rejected: {
    what: "We couldn't take this one on.",
    next: "Get in touch if you'd like to talk about it.",
  },
  cancelled: {
    what: "This was cancelled.",
    next: "Start a new request whenever you need to.",
  },
};
