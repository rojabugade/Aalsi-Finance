import { beforeEach, describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), message: vi.fn(), error: vi.fn() } }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/lib/offline/use-capture-queue", () => ({ useCaptureQueue: () => ({ items: [], online: true }) }));
vi.mock("@/lib/offline/sync", () => ({
  enqueueCapture: vi.fn(),
  flushQueue: vi.fn(async () => ({ synced: 0, failed: 0 })),
  removeCapture: vi.fn(),
  retryCapture: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => ({
  useDocuments: () => ({ data: [] }),
  documentsPending: () => false,
  provenanceLabel: () => "",
}));
vi.mock("@/lib/api/review", () => ({
  useReviewQueue: () => ({ data: { groups: [], items: [] } }),
  useResolveReview: () => ({ isPending: false, mutateAsync: vi.fn() }),
  useResolveGroup: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("@/components/capture/manual-transaction-entry", () => ({ ManualTransactionEntry: () => <button>Manual</button> }));
vi.mock("@/components/capture/csv-wizard", () => ({
  isSpreadsheetFile: (f: File) => /\.(csv|xlsx)$/i.test(f.name),
  CsvWizard: ({ initialFile, onDone }: { initialFile?: File; onDone?: () => void }) => (
    <div>
      <span>mapping:{initialFile?.name}</span>
      <button onClick={() => onDone?.()}>finish-sheet</button>
    </div>
  ),
}));

import CapturePage from "@/app/(app)/capture/page";
import { enqueueCapture } from "@/lib/offline/sync";

function sheet(name: string) {
  return new File(["a,b\n1,2"], name, { type: "text/csv" });
}

describe("spreadsheet queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps each selected sheet in turn, dropping none", async () => {
    render(<CapturePage />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [sheet("a.csv"), sheet("b.csv"), sheet("c.csv")],
    });
    fireEvent.change(input);

    expect(await screen.findByText("mapping:a.csv")).toBeTruthy();
    fireEvent.click(screen.getByText("finish-sheet"));
    expect(await screen.findByText("mapping:b.csv")).toBeTruthy();
    fireEvent.click(screen.getByText("finish-sheet"));
    expect(await screen.findByText("mapping:c.csv")).toBeTruthy();
  });

  it("threads selected type and one-receipt grouping to document uploads", async () => {
    render(<CapturePage />);
    fireEvent.click(screen.getByRole("button", { name: /receipt/i }));
    fireEvent.click(screen.getByLabelText(/these files are one document/i));

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", {
      value: [new File(["img"], "receipt.png", { type: "image/png" })],
    });
    fireEvent.change(input);

    await waitFor(() => {
      expect(enqueueCapture).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({ docType: "receipt", groupHint: "single" }),
      );
    });
  });
});
