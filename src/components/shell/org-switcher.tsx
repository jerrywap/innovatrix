"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveOrganizationAction } from "@/features/auth/actions";

/**
 * Switch the organization the session is acting as — §76.
 *
 * Nothing here is trusted. The action calls Better Auth's
 * `setActiveOrganization`, which verifies membership server-side before
 * switching; passing an id this user does not belong to is refused. The list
 * below is a convenience, not a capability.
 *
 * `router.refresh()` after switching is required, not cosmetic: every screen in
 * the shell is scoped by `activeOrganizationId`, so without it the chrome says
 * one organization while the data underneath belongs to another.
 *
 * Hidden entirely for a customer with one organization — a switcher with
 * nothing to switch to is chrome pretending to be a feature.
 */

export interface OrgOption {
  id: string;
  name: string;
  role: string;
}

export function OrgSwitcher({
  organizations,
  activeId,
}: {
  organizations: readonly OrgOption[];
  activeId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const active = organizations.find((org) => org.id === activeId);

  if (organizations.length <= 1) {
    return active ? (
      <span className="text-muted-foreground hidden max-w-[220px] truncate text-[13px] sm:block">
        {active.name}
      </span>
    ) : null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={pending}
        className="border-border hover:bg-surface-muted flex max-w-[240px] items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-60"
      >
        <span className="truncate">{active?.name ?? "Choose organization"}</span>
        <ChevronsUpDown className="text-subtle size-3.5 shrink-0" aria-hidden />
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        <DropdownMenuSeparator />

        {organizations.map((org) => (
          <DropdownMenuItem
            key={org.id}
            disabled={pending}
            onSelect={(event) => {
              event.preventDefault();
              if (org.id === activeId) return;
              startTransition(async () => {
                const result = await setActiveOrganizationAction(org.id);
                if (result.ok) router.refresh();
              });
            }}
          >
            <span className="min-w-0 flex-1 truncate">{org.name}</span>
            <span className="text-subtle text-[11px] capitalize">{org.role}</span>
            {org.id === activeId && <Check className="size-3.5" aria-hidden />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
