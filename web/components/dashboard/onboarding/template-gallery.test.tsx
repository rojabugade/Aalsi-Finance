import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplateGallery } from "./template-gallery";
import { TEMPLATES } from "@/lib/dashboard/templates";

describe("TemplateGallery", () => {
  it("renders a card per template", () => {
    render(<TemplateGallery onPick={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(TEMPLATES.length);
  });

  it("fires onPick with the template id", () => {
    const onPick = vi.fn();
    render(<TemplateGallery onPick={onPick} labelKey="goal" />);
    fireEvent.click(screen.getByRole("button", { name: /Pay off debt/i }));
    expect(onPick).toHaveBeenCalledWith("debt");
  });
});
