import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  plan: { data: undefined as Array<Record<string, unknown>> | undefined, isLoading: false },
  update: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("@/lib/api/guidance", () => ({
  usePlanItems: () => state.plan,
  useUpdatePlanItem: () => state.update,
}));

import { PlanList } from "./plan-list";

const items = [
  {
    id: "open-1",
    title: "Review annual reporting",
    rationale: "Confirm the current reporting rules.",
    domain: "cross_border",
    status: "open",
    due_date: "2026-01-15",
    source_refs: [
      { title: "IRS guidance", source_url: "https://example.test/irs" },
      { title: "FinCEN guidance", source_url: "https://example.test/fincen" },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "completed-1",
    title: "Learn account rules",
    rationale: null,
    domain: "investment",
    status: "completed",
    due_date: null,
    source_refs: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "dismissed-1",
    title: "Review old checklist",
    rationale: null,
    domain: "general",
    status: "dismissed",
    due_date: null,
    source_refs: [],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

afterEach(() => {
  state.plan.data = undefined;
  state.plan.isLoading = false;
  state.update.mutateAsync.mockReset();
  state.update.isPending = false;
});

describe("PlanList", () => {
  it("shows a loading state", () => {
    state.plan.isLoading = true;
    render(<PlanList />);

    expect(screen.getByText("Loading your plan…")).toBeInTheDocument();
  });

  it("offers Overview actions when the selected filter has no items", () => {
    state.plan.data = [];
    render(<PlanList />);

    expect(screen.getByText("No open items yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "?section=overview");
    expect(screen.getByRole("link", { name: "Ask a question" })).toHaveAttribute("href", "?section=overview");
    expect(screen.getByRole("link", { name: "Build my plan" })).toHaveAttribute("href", "?section=overview");
  });

  it("starts on open items and renders labels and source links", () => {
    state.plan.data = items;
    render(<PlanList />);

    expect(screen.getByText("Review annual reporting")).toBeInTheDocument();
    expect(screen.queryByText("Learn account rules")).not.toBeInTheDocument();
    expect(screen.getByText("Cross-border")).toBeInTheDocument();
    expect(screen.getByText("Due: 2026-01-15")).toBeInTheDocument();
    expect(screen.getByText("2 sources")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "IRS guidance" })).toHaveAttribute("href", "https://example.test/irs");
  });

  it("changes the visible rows when a status filter is selected", () => {
    state.plan.data = items;
    render(<PlanList />);

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    expect(screen.getByText("Learn account rules")).toBeInTheDocument();
    expect(screen.queryByText("Review annual reporting")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismissed" }));
    expect(screen.getByText("Review old checklist")).toBeInTheDocument();
  });

  it("completes an open item", async () => {
    state.plan.data = items;
    state.update.mutateAsync.mockResolvedValue({});
    render(<PlanList />);

    fireEvent.click(screen.getByRole("button", { name: "Mark Review annual reporting complete" }));

    await waitFor(() => {
      expect(state.update.mutateAsync).toHaveBeenCalledWith({
        id: "open-1",
        body: { status: "completed" },
      });
    });
  });

  it("reopens a completed item", async () => {
    state.plan.data = items;
    state.update.mutateAsync.mockResolvedValue({});
    render(<PlanList />);
    fireEvent.click(screen.getByRole("button", { name: "Completed" }));

    fireEvent.click(screen.getByRole("button", { name: "Reopen Learn account rules" }));

    await waitFor(() => {
      expect(state.update.mutateAsync).toHaveBeenCalledWith({
        id: "completed-1",
        body: { status: "open" },
      });
    });
  });

  it("edits an item", async () => {
    state.plan.data = items;
    state.update.mutateAsync.mockResolvedValue({});
    render(<PlanList />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Review annual reporting" }));
    fireEvent.change(await screen.findByLabelText(/Title/), { target: { value: "Review reporting deadline" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(state.update.mutateAsync).toHaveBeenCalledWith({
        id: "open-1",
        body: {
          title: "Review reporting deadline",
          rationale: "Confirm the current reporting rules.",
          due_date: "2026-02-01",
        },
      });
    });
  });

  it("dismisses an open item", async () => {
    state.plan.data = items;
    state.update.mutateAsync.mockResolvedValue({});
    render(<PlanList />);

    fireEvent.click(screen.getByRole("button", { name: "Dismiss Review annual reporting" }));

    await waitFor(() => {
      expect(state.update.mutateAsync).toHaveBeenCalledWith({
        id: "open-1",
        body: { status: "dismissed" },
      });
    });
  });

  it("keeps the row visible and reports a failed mutation", async () => {
    state.plan.data = items;
    state.update.mutateAsync.mockRejectedValue(new Error("offline"));
    render(<PlanList />);

    fireEvent.click(screen.getByRole("button", { name: "Mark Review annual reporting complete" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't update this item. Please try again.");
    expect(screen.getByText("Review annual reporting")).toBeInTheDocument();
  });
});
