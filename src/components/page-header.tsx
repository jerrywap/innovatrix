import type { Route } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The top of every screen inside a shell: where am I, and what can I do here?
 *
 * `actions` sits on the same row as the title on desktop and wraps beneath on
 * mobile, so the primary action is never below the fold on a phone — §102 is
 * about acting, and an action you have to scroll to find isn't offered.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  className,
}: {
  title: string;
  description?: string;
  breadcrumbs?: ReadonlyArray<{ label: string; href?: Route }>;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb">
          <ol className="text-subtle flex flex-wrap items-center gap-1 text-[12.5px]">
            {breadcrumbs.map((crumb, index) => (
              <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                {index > 0 && <ChevronRight className="size-3" aria-hidden />}
                {crumb.href ? (
                  <Link href={crumb.href} className="hover:text-foreground transition">
                    {crumb.label}
                  </Link>
                ) : (
                  // The current page: present for orientation, not a link.
                  <span aria-current="page">{crumb.label}</span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <h1 className="font-display truncate text-[22px] tracking-[-0.03em] sm:text-[26px]">
            {title}
          </h1>
          {description && (
            <p className="text-muted-foreground mt-1 text-[13.5px]">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}
