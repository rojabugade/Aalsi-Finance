import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  wizard: { mutateAsync: vi.fn(), isPending: false },
  create: { mutateAsync: vi.fn(), isPending: false },
  plan: { data: [] as Array<{ title: string; domain: string; status: string }>, isLoading: false },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/api/guidance", () => ({
  useWizard: () => state.wizard,
  useCreatePlanItem: () => state.create,
  usePlanItems: () => state.plan,
}));

vi.mock("sonner", () => ({ toast: state.toast }));

import { PlanBuilder } from "./plan-builder";

const result = {
  checklist: [
    {
      title: "Review annual reporting",
      topic: "Tax reporting",
      source_type: "Government guidance",
      why_it_may_apply: "Your countries and accounts may require a filing.",
      source_url: "https://example.test/reporting",
      effective_date: "2026-01-01",
      domain: "cross_border" as const,
    },
    {
      title: "Learn investment account rules",
      topic: null,
      source_type: null,
      why_it_may_apply: "Account rules vary by residency.",
      source_url: null,
      effective_date: null,
      domain: "investment" as const,
    },
  ],
  reminders: [],
  citations: [],
  disclaimer: "General information only.",
};

function renderBuilder() {
  return render(<PlanBuilder />);
}

function fillBuilder() {
  fireEvent.change(screen.getByLabelText("Countries"), { target: { value: "US, IN" } });
  fireEvent.change(screen.getByLabelText("Residency"), { target: { value: "US resident" } });
  fireEvent.change(screen.getByLabelText("Expected annual transfers"), { target: { value: "2500" } });
  fireEvent.click(screen.getByLabelText("Brokerage"));
}

afterEach(() => {
  state.wizard.mutateAsync.mockReset();
  state.wizard.isPending = false;
  state.create.mutateAsync.mockReset();
  state.create.isPending = false;
  state.plan.data = [];
  state.plan.isLoading = false;
  state.toast.success.mockReset();
  state.toast.error.mockReset();
});

describe("PlanBuilder", () => {
  it("serializes the form into a guidance wizard request without creating reminders", async () => {
    state.wizard.mutateAsync.mockResolvedValue(result);
    renderBuilder();
    fillBuilder();

    fireEvent.click(screen.getByRole("button", { name: "Build checklist" }));

    await waitFor(() => {
      expect(state.wizard.mutateAsync).toHaveBeenCalledWith({
        crossBorder: false,
        body: {
          countries: ["US", "IN"],
          residency: "US resident",
          annual_transfer_amount: "2500",
          transfer_currency: "USD",
          account_types: ["Brokerage"],
          create_reminders: false,
        },
      });
    });
  });

  it("shows a loading control while the wizard is building", () => {
    state.wizard.isPending = true;
    renderBuilder();

    expect(screen.getByRole("button", { name: "Building checklist…" })).toBeDisabled();
  });

  it("keeps the form available after a wizard error", async () => {
    state.wizard.mutateAsync.mockRejectedValue(new Error("offline"));
    renderBuilder();
    fillBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Build checklist" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't build your checklist");
    expect(screen.getByLabelText("Countries")).toHaveValue("US, IN");
  });

  it("renders typed checklist details and saves an individual item", async () => {
    state.wizard.mutateAsync.mockResolvedValue(result);
    state.create.mutateAsync.mockResolvedValue({});
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Build checklist" }));

    expect(await screen.findByText("Review annual reporting")).toBeInTheDocument();
    expect(screen.getByText("Cross-border")).toBeInTheDocument();
    expect(screen.getByText(/Government guidance/)).toBeInTheDocument();
    expect(screen.getByText(/Effective 2026-01-01/)).toBeInTheDocument();
    expect(screen.getAllByTestId("checklist-effective-date")[1]).toHaveTextContent("Date unavailable");

    fireEvent.click(screen.getAllByRole("button", { name: "Add to My Plan" })[0]);

    await waitFor(() => {
      expect(state.create.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        title: "Review annual reporting",
        rationale: "Your countries and accounts may require a filing.",
        domain: "cross_border",
      }));
      expect(state.toast.success).toHaveBeenCalledWith("Plan item processed for My Plan.");
    });
  });

  it("confirms add-all once and skips checklist entries already in the open plan", async () => {
    state.wizard.mutateAsync.mockResolvedValue(result);
    state.create.mutateAsync.mockResolvedValue({});
    state.plan.data = [{ title: "review   annual reporting", domain: "cross_border", status: "open" }];
    renderBuilder();
    fireEvent.click(screen.getByRole("button", { name: "Build checklist" }));
    await screen.findByText("Review annual reporting");

    fireEvent.click(screen.getByRole("button", { name: "Add all to My Plan" }));
    expect(screen.getByRole("dialog", { name: "Add all checklist items?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add all" }));

    await waitFor(() => {
      expect(state.create.mutateAsync).toHaveBeenCalledTimes(1);
      expect(state.create.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({
        title: "Learn investment account rules",
        domain: "investment",
      }));
      expect(state.toast.success).toHaveBeenCalledWith("Processed 1 item for My Plan. 1 item was already in your plan.");
    });
  });
});
