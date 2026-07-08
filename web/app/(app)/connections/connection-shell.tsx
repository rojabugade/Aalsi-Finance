export function ConnectionShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-card-sm border border-border bg-card p-4 shadow-card">
      <div className="mb-3">
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        <p className="text-sm text-muted">{description}</p>
      </div>
      <div className="flex-1 space-y-3 text-sm">{children}</div>
      <div className="mt-4 flex flex-wrap gap-2">{footer}</div>
    </div>
  );
}
