import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("@/lib/api/transactions", () => ({
  useTransactions: () => ({ data: [], isLoading: false, isError: false }),
  useCategories: () => ({ data: [] }),
  useCreateTransaction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/api/widget-data", () => ({
  useRecurringSeries: () => ({ data: [], isLoading: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import TransactionsPage from "./page";

function renderPage() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <TransactionsPage />
    </QueryClientProvider>,
  );
}

it("renders the migrated Spend page with a Classic escape hatch", async () => {
  renderPage();
  expect(await screen.findByTestId("new-spend")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Transactions" })).toBeInTheDocument();
  expect(screen.getByTestId("new-quick-add")).toBeInTheDocument();
});
