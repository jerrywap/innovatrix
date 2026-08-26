import { Clock, FileCheck2, Wallet } from "lucide-react";

/**
 * "What happens after you submit", beside the application form.
 *
 * `navigation.ts` has claimed for a while that "The apply page carries its own
 * explanation of what happens next" — as the argument for sending a signed-in user
 * straight here rather than through `/sell`. It did not carry one. This is that
 * explanation.
 *
 * ## Every sentence is taken from something that already exists
 *
 * Not written fresh. The three panels restate, in order, the `VendorApplied` email a
 * vendor receives minutes later, the requirement copy on `/dashboard/selling/verification`,
 * and the agreement's own account of the two verification levels. Writing new prose
 * here would give an applicant a fourth version of the journey to reconcile, and the
 * one thing this page must not do is set an expectation the next screen contradicts.
 *
 * In particular it says identity verification runs **alongside** the review rather
 * than after it, and that payout details can wait — both are true, both are the
 * things applicants get wrong, and both are load-bearing for how long this feels.
 */
export function ApplyAside() {
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-24 lg:self-start">
      <Panel
        icon={Clock}
        title="Somebody reads it"
        body="Every application is read by a person, and you hear back either way. Being accepted is not automatic."
      />
      <Panel
        icon={FileCheck2}
        title="Verify your identity meanwhile"
        body="That check runs alongside the review, not after it, and it is the step that unlocks listing a product. Have a passport, driving licence or national ID card ready, and something showing your address from the last three months."
      />
      <Panel
        icon={Wallet}
        title="Payout details can wait"
        body="They are a separate check and only matter when money leaves. You can list, sell and earn before it finishes — earnings wait in your balance until it clears."
      />

      <p className="text-subtle px-1 text-[12px] leading-relaxed">
        You accept the vendor agreement as part of applying, and we record the version you
        accepted against your account.
      </p>
    </aside>
  );
}

function Panel({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Clock;
  title: string;
  body: string;
}) {
  return (
    <div className="border-border bg-surface-muted/40 flex flex-col rounded-xl border p-4">
      <span className="flex items-center gap-2">
        <Icon className="text-signal-text size-4 shrink-0" aria-hidden />
        <span className="text-[13.5px] font-medium">{title}</span>
      </span>
      <p className="text-muted-foreground mt-1.5 text-[12.5px] leading-relaxed">{body}</p>
    </div>
  );
}
