"use client";

import { Citations } from "@/components/guidance/citations";
import { Button } from "@/components/ui/button";
import type { AskOut } from "@/lib/api/guidance";

export function GuidanceAnswer({
  result,
  onSave,
}: {
  result: AskOut;
  onSave: () => void;
}) {
  return (
    <article className="space-y-3 rounded-card-sm border border-border bg-card p-3 shadow-card">
      <p className="whitespace-pre-wrap text-sm leading-6">{result.answer}</p>
      <Citations citations={result.citations} />
      <p className="text-xs text-muted">{result.disclaimer}</p>
      <Button type="button" size="sm" variant="outline" onClick={onSave}>
        Save to My Plan
      </Button>
    </article>
  );
}
