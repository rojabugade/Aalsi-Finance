import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  transfers: {
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  limits: {
    data: undefined as Record<string, unknown> | undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  },
  create: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api/guidance", () => ({
  useTransfers: () => state.transfers,
  useLimits: () => state.limits,
  useCreateTransfer: () => state.create,
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { CrossBorderModule } from "./cross-border-module";

afterEach(() => {
  state.transfers.data = [];
  state.transfers.isLoading = false;
  state.transfers.isError = false;
  state.transfers.refetch.mockReset();
  state.limits.data = undefined;
  state.limits.isLoading = false;
  state.limits.isError = false;
  state.limits.refetch.mockReset();
  state.create.mutateAsync.mockReset();
  state.create.isPending = false;
});

describe("CrossBorderModule", () => {
  it("offers separate retries when transfer and limit queries fail", () => {
    state.transfers.isError = true;
    state.limits.isError = true;
    render(<CrossBorderModule />);

    fireEvent.click(screen.getByRole("button", { name: "Retry transfers" }));
    fireEvent.click(screen.getByRole("button", { name: "Retry limits" }));

    expect(state.transfers.refetch).toHaveBeenCalledTimes(1);
    expect(state.limits.refetch).toHaveBeenCalledTimes(1);
  });

  it("passes a corpus warning and its citations to the plan-save callback", () => {
    const onSaveWarning = vi.fn();
    const warning = {
      message: "Transfer total is near a corpus-defined limit; verify the cited source before acting.",
      ratio: "0.80",
      limit_title: "LRS annual limit",
    };
    const citations = [{ title: "RBI limit", source_type: "Regulator", effective_date: "2026-01-01" }];
    state.limits.data = { totals: [], limits: [], warnings: [warning], citations };

    render(<CrossBorderModule onSaveWarning={onSaveWarning} />);

    fireEvent.click(screen.getByRole("button", { name: "Save warning to My Plan" }));

    expect(onSaveWarning).toHaveBeenCalledWith(warning, citations);
  });
});
