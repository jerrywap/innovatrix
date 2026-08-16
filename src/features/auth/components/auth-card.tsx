export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface shadow-lift rounded-2xl border p-7">
      <h1 className="font-display text-[24px] tracking-[-0.03em]">{title}</h1>
      {description && (
        <p className="text-muted-foreground mt-1.5 text-[13.5px]">{description}</p>
      )}
      <div className="mt-6">{children}</div>
      {footer && (
        <div className="border-border text-muted-foreground mt-6 border-t pt-5 text-[13px]">
          {footer}
        </div>
      )}
    </div>
  );
}
