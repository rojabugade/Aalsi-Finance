import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { MemoryCard } from "../memory-card";

vi.mock("@/lib/api/analyst", () => ({
  useMemoryStatus: () => ({
    isLoading: false,
    data: {
      sources: [
        { source_type: "transaction", count: 1240, last_indexed: "2026-06-25T10:00:00Z" },
        { source_type: "loan", count: 4, last_indexed: "2026-06-25T09:00:00Z" },
        { source_type: "account", count: 3, last_indexed: "2026-06-25T09:00:00Z" },
        { source_type: "income_source", count: 1, last_indexed: "2026-06-25T09:00:00Z" },
        { source_type: "investment_holding", count: 2, last_indexed: "2026-06-25T09:00:00Z" },
      ],
      last_synced: "2026-06-25T10:00:00Z",
    },
  }),
  useReindexMemory: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient();
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("MemoryCard", () => {
  it("renders per-source coverage and a re-sync button", async () => {
    render(wrap(<MemoryCard />));
    await waitFor(() => {
      expect(screen.getByText(/1,240 transactions/i)).toBeInTheDocument();
      expect(screen.getByText(/4 loans/i)).toBeInTheDocument();
      expect(screen.getByText(/3 accounts/i)).toBeInTheDocument();
      expect(screen.getByText(/1 income sources/i)).toBeInTheDocument();
      expect(screen.getByText(/2 investment holdings/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /re-sync now/i })).toBeInTheDocument();
    });
  });
});
