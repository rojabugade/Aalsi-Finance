"use client";

import { useSearchParams } from "next/navigation";

import { GuidanceOverview } from "@/components/guidance/guidance-overview";
import { CrossBorderGuidance } from "@/components/guidance/cross-border-guidance";
import { PlanList } from "@/components/guidance/plan-list";
import { guidanceSection, type GuidanceSection } from "@/components/guidance/section";

export default function GuidancePage() {
  return <GuidanceWorkspace section={guidanceSection(useSearchParams())} />;
}

function GuidanceWorkspace({ section }: { section: GuidanceSection }) {
  if (section === "overview") return <GuidanceOverview />;
  if (section === "plan") return <PlanList />;
  return <CrossBorderGuidance />;
}
