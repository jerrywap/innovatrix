"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * shadcn's Popover, copied in — the `radix-ui` umbrella already ships
 * `@radix-ui/react-popover`, so this adds no dependency.
 *
 * Styled from `DropdownMenuContent`, so a popover and a menu do not read as two
 * different kinds of overlay. The one deliberate difference is width: a menu is
 * `w-(--radix-dropdown-menu-trigger-width)`, matching its trigger, while a
 * popover holds arbitrary content and is sized by whatever is inside it.
 *
 * ## Why a popover rather than a dropdown menu
 *
 * A Radix menu owns the keyboard — arrow keys move focus between items and
 * printable characters do typeahead — so a `<input>` inside one cannot be typed
 * into. It is also not a legal parent for a textbox under the `menu` role. That is
 * the whole reason `multi-select.tsx` is built on this rather than on
 * `DropdownMenuCheckboxItem`.
 */
function Popover({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverAnchor({ ...props }: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

function PopoverContent({
  className,
  align = "start",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "bg-popover text-popover-foreground ring-foreground/10 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 z-50 max-h-(--radix-popover-content-available-height) w-72 origin-(--radix-popover-content-transform-origin) rounded-lg p-1 shadow-md ring-1 duration-100 outline-none",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
