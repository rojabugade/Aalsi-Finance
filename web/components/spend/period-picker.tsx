"use client";

import { DateRangePicker } from "@/components/date-range-picker";

/**
 * Period control for the Spend surfaces — thin wrapper around the shared
 * DateRangePicker in URL‑backed mode.
 */
export function PeriodPicker() {
  return <DateRangePicker mode="url" variant="pill" />;
}
