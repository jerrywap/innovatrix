import Link from "next/link";
import { ShieldAlert } from "lucide-react";

/**
 * The 403 page — rendered wherever `forbidden()` is called (see `dal.ts`).
 *
 * Deliberately vague about *what* was refused. A message like "you need
 * payment.reconcile to see /admin/payments" tells someone probing the app the
 * exact shape of the permission model and which screens exist. What the person
 * actually needs is who to ask, and a way back.
 *
 * Standalone chrome rather than the shell's: `forbidden()` terminates the
 * segment, so the sidebar for that surface may not be appropriate — and if the
 * refusal came from the admin area, rendering admin chrome around it would be
 * odd.
 */
export default function Forbidden() {
  return (
    <div className="bg-background flex min-h-full flex-1 items-center justify-center px-5 py-16">
      <div className="flex max-w-[46ch] flex-col items-center gap-4 text-center">
        <span className="bg-surface-muted text-muted-foreground grid size-12 place-items-center rounded-2xl">
          <ShieldAlert className="size-5" aria-hidden />
        </span>

        <div>
          <h1 className="font-display text-[24px] tracking-[-0.03em]">
            You don&rsquo;t have access to this
          </h1>
          <p className="text-muted-foreground mt-1.5 text-[13.5px]">
            Your account doesn&rsquo;t include this area. If you think it should, ask whoever
            manages roles for your team.
          </p>
        </div>

        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/staff"
            className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13.5px] font-medium transition"
          >
            Back to queues
          </Link>
          <Link
            href="/dashboard"
            className="border-border hover:bg-surface-muted rounded-full border px-4 py-2 text-[13.5px] font-medium transition"
          >
            Your dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
