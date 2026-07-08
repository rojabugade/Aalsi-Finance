"use client";
import { Check } from "lucide-react";
import { TEMPLATES, type TemplateId } from "@/lib/dashboard/templates";

export function TemplateGallery({
  onPick,
  selectedId = null,
  labelKey = "name",
}: {
  onPick: (id: TemplateId) => void;
  selectedId?: TemplateId | null;
  labelKey?: "goal" | "name";
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {TEMPLATES.map((t) => {
        const Icon = t.icon;
        const selected = selectedId === t.id;
        const primary = labelKey === "goal" ? t.goal : t.name;
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onPick(t.id)}
            className={`flex min-h-[92px] w-full items-start gap-3 rounded-[0.95rem] border p-4 text-left transition-colors ${selected ? "border-accent bg-accent-soft/15 shadow-[0_0_0_1px_var(--accent)]" : "border-border bg-card/35 hover:border-accent/50"}`}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft/40 text-accent">
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold leading-4">{primary}</span>
              <span className="mt-1.5 block text-[11px] leading-4 text-muted">{t.description}</span>
            </span>
            {selected && (
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-on-accent">
                <Check className="size-3.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
