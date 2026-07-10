import { Suspense } from "react";
import { NewDashboard } from "@/components/dashboard/new-dashboard";

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <NewDashboard />
    </Suspense>
  );
}
