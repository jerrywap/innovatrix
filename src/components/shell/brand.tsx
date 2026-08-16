import Link from "next/link";
import { cn } from "@/lib/utils";

/**
 * The wordmark. One definition, so the four shells cannot drift apart.
 *
 * `href` varies by surface — the logo means "take me home", and home is the
 * marketplace for a visitor and the dashboard for a signed-in customer.
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
    <Link href={href} className={cn("flex items-center gap-2.5", className)}>
      <span className="bg-signal text-signal-contrast grid h-8 w-8 shrink-0 place-items-center rounded-xl text-[15px] font-bold">
        i
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-[-0.03em]">INNOVATRIX</span>
      )}
    </Link>
  );
}
