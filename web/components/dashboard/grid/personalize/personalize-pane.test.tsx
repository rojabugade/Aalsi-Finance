import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PersonalizePane } from "./personalize-pane";
import { ThemeProvider } from "@/components/theme/theme-provider";

const controller = { boardId: "dashboard", state: { items: [], prefs: { density: "cozy", densityMode: "balanced", privacy: "off",
  radius: 20, glass: 0, shadow: 0, accent: null, themePreset: "indigo-light", range: "3m", showLabels: true } },
  library: [], selectedId: null, select: vi.fn(), setPrefs: vi.fn(), updateConfig: vi.fn(), applyItems: vi.fn(), applySetup: vi.fn(),
  hideWidget: vi.fn(), addWidget: vi.fn(), reset: vi.fn() } as any;

describe("PersonalizePane", () => {
  it("renders tabs and switches active section", () => {
    const onTabChange = vi.fn();
    render(<PersonalizePane open tab="layout" onTabChange={onTabChange} onOpenChange={vi.fn()} controller={controller} />);
    for (const t of ["Layout", "Widgets", "Appearance", "Privacy"]) {
      expect(screen.getByRole("tab", { name: t })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("tab", { name: "Appearance" }));
    expect(onTabChange).toHaveBeenCalledWith("appearance");
  });

  it("renders nothing when closed", () => {
    const { container } = render(<PersonalizePane open={false} tab="layout" onTabChange={vi.fn()} onOpenChange={vi.fn()} controller={controller} />);
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("tab", { name: "Layout" })).not.toBeInTheDocument();
  });

  it("choosing a preset template swaps in that template's widgets and prefs", () => {
    controller.applySetup.mockClear();
    render(<PersonalizePane open tab="layout" onTabChange={vi.fn()} onOpenChange={vi.fn()} controller={controller} />);
    fireEvent.click(screen.getByRole("button", { name: /Minimal Money/i }));
    expect(controller.applySetup).toHaveBeenCalledTimes(1);
    const [items, prefs] = controller.applySetup.mock.calls[0];
    expect(items.map((i: { type: string }) => i.type)).toContain("netWorth");
    expect(prefs).toMatchObject({ densityMode: "calm", density: "spacious" });
  });

  it("layout tab exposes quick tweaks", () => {
    controller.setPrefs.mockClear();
    render(<PersonalizePane open tab="layout" onTabChange={vi.fn()} onOpenChange={vi.fn()} controller={controller} />);

    fireEvent.click(screen.getByRole("button", { name: "Compact" }));
    expect(controller.setPrefs).toHaveBeenCalledWith({ density: "compact" });
  });

  it("theme tab applies a preset, persists it, and locks unsupported modes", () => {
    controller.setPrefs.mockClear();
    document.documentElement.setAttribute("data-theme", "indigo-light");
    render(
      <ThemeProvider>
        <PersonalizePane open tab="appearance" onTabChange={vi.fn()} onOpenChange={vi.fn()} controller={controller} />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /dollar bill/i }));
    expect(controller.setPrefs).toHaveBeenCalledWith({ themePreset: "dollar-light" });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dollar-light");
    // Dollar Bill is light-only → Dark mode toggle is disabled
    expect(screen.getByRole("button", { name: /dark/i })).toBeDisabled();
  });
});
