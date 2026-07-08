import { Suspense } from "react";
import { RojaDashboard } from "@/components/dashboard/classic-dashboard";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <RojaDashboard />
    </Suspense>
  );
}
