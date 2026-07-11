"use client";

import { useSearchParams } from "next/navigation";

import { guidanceSection, type GuidanceSection } from "@/components/guidance/section";

const SECTION_COPY: Record<GuidanceSection, { title: string; description: string }> = {
  overview: {
    title: "Guidance overview",
    description: "Ask sourced questions and turn useful answers into a plan.",
  },
  "cross-border": {
    title: "Cross-border guidance",
    description: "Review sourced guidance, transfers, and corpus-defined limits.",
  },
  plan: {
    title: "My Plan",
    description: "Review, complete, or dismiss the guidance items you saved.",
  },
};

export default function GuidancePage() {
  return <GuidanceWorkspace section={guidanceSection(useSearchParams())} />;
}

function GuidanceWorkspace({ section }: { section: GuidanceSection }) {
  const copy = SECTION_COPY[section];
  return (
    <section
      aria-labelledby={`guidance-${section}-title`}
      className="rounded-card-sm border border-border bg-card p-6 shadow-card"
    >
      <h2 id={`guidance-${section}-title`} className="text-lg font-bold tracking-tight text-fg">
        {copy.title}
      </h2>
      <p className="mt-2 text-sm text-muted">{copy.description}</p>
    </section>
  );
}
