import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";
import { BrandMark } from "./brand-mark";

/**
 * The lockup. One definition, so the shells cannot drift apart.
 *
 * **The logo always goes to `/`, on every surface.** The wordmark means "take me
 * back to the site", and the site is the storefront.
 *
 * It used to vary: `AppShell` and `MobileNav` took a `homeHref`, and the three
 * shells each passed their own segment root — so on `/staff` the logo went to
 * `/staff`, which is where you already were. Every shell's nav already links its
 * own root (Queues → `/staff`, Admin → `/admin`, Dashboard → `/dashboard`), so
 * pointing the logo there spent the one control that reliably leads *out* on a
 * destination that was already one click away.
 *
 * The prop is gone rather than set to `"/"` in three places. A knob that can
 * only hold one correct value is a knob that drifts back.
 *
 * `href` survives here because a logo component should be able to link
 * somewhere, but every current surface takes the default.
 *
 * No tagline here. §7 is explicit that it should not sit beside the logo in
 * every interface, and a wordmark is all a dashboard header needs; the tagline
 * belongs on the surfaces that are introducing the brand rather than the ones
 * being used by someone who already knows it.
 *
 * Mixed case, not the uppercase treatment this component used to carry: §2
 * allows all-caps only where it is a deliberate part of an existing treatment,
 * and the brand sheet's lockup is `CoSetup`.
 */
export function Brand({
  href = "/",
  className,
  compact = false,
}: {
  href?: React.ComponentProps<typeof Link>["href"];
  className?: string;
  /** Mark only, for a collapsed sidebar. */
  compact?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn("flex items-center gap-2.5", className)}
      aria-label={compact ? BRAND.name : undefined}
    >
      <BrandMark className="h-[26px] w-[26px] shrink-0" />
      {!compact && (
        <span className="text-[15.5px] font-semibold tracking-[-0.03em]">{BRAND.name}</span>
      )}
    </Link>
  );
}
