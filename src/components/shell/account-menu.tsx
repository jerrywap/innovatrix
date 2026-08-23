"use client";

import Link from "next/link";
import { useTransition } from "react";
import { LogOut, Shield, UserCog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/lib/initials";
import { signOutAction } from "@/features/auth/actions";

/**
 * Account menu.
 *
 * Sign-out is a **server action inside a transition**, not a client call to
 * Better Auth. Two reasons: the session cookie is `httpOnly` so the server has
 * to clear it anyway, and routing through the action means one code path —
 * a client sign-out that forgot to invalidate the router cache leaves stale
 * authenticated markup on screen after the session is gone.
 */
export function AccountMenu({
  name,
  email,
  isStaff,
}: {
  name: string;
  email: string;
  isStaff: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const initials = initialsOf(name || email);

  return (
    <DropdownMenu>
      {/*
        No `aria-label`. WCAG 2.5.3 (Label in Name) wants the accessible name to
        *contain* the visible text, so a voice-control user can say what they
        see — and an `aria-label` of "Account menu" over visible initials "AL"
        replaces the name rather than extending it, which axe flags.
        `aria-hidden` on the initials doesn't help either: axe still counts them
        as visible text.

        Appending a screen-reader-only phrase instead makes the name
        "AL account menu" — it contains the visible text and still says what the
        button does.
      */}
      <DropdownMenuTrigger className="border-border hover:bg-surface-muted flex size-9 items-center justify-center rounded-full border text-[12px] font-semibold transition">
        {initials}
        <span className="sr-only"> account menu</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-[13.5px] font-medium">{name || "Your account"}</span>
          <span className="text-muted-foreground text-[12px] font-normal">{email}</span>
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/dashboard/account">
            <UserCog className="size-4" aria-hidden />
            Account settings
          </Link>
        </DropdownMenuItem>

        {isStaff && (
          <DropdownMenuItem asChild>
            <Link href="/staff">
              <Shield className="size-4" aria-hidden />
              Staff console
            </Link>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          disabled={pending}
          onSelect={(event) => {
            // Radix closes the menu on select and unmounts this item; without
            // preventing the default the transition is torn down mid-flight.
            event.preventDefault();
            startTransition(() => {
              void signOutAction();
            });
          }}
        >
          <LogOut className="size-4" aria-hidden />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
