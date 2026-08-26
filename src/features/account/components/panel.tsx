import { cn } from "@/lib/utils";

/**
 * One bordered block with a heading — the unit every account tab is built from.
 *
 * A Server Component, and deliberately dumb. The tabs differ in what they hold,
 * not in how a section is framed, and the alternative was the same fifteen
 * classes and the same heading sizes copied into eight places. The typography
 * matches the settings screens already in the codebase (`ai-settings`,
 * vendor settings) rather than inventing a third scale.
 */
export function Panel({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: string;
  /** A control that belongs to the section as a whole, not to a row in it. */
  action?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface flex flex-col gap-4 rounded-xl border p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h2 className="font-display text-[15.5px] tracking-[-0.02em]">{title}</h2>
          {description && (
            <p className="text-muted-foreground mt-1 text-[13px] leading-relaxed">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
