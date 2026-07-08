export function SectionIntro({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-3" data-testid="section-intro">
      <h2 className="text-lg font-bold tracking-tight">{title}</h2>
      <p className="text-sm text-muted">{blurb}</p>
    </div>
  );
}
