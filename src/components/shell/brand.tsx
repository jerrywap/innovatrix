import Link from "next/link";
import { cn } from "@/lib/utils";
import { BRAND } from "@/config/brand";
import { BrandMark } from "./brand-mark";

/**
 * The lockup. One definition, so the shells cannot drift apart.
 *
 * `href` varies by surface — the logo means "take me home", and home is the
 * marketplace for a visitor and the dashboard for a signed-in customer.
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
