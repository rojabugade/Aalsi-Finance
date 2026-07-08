import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  appendMessage, getThread, resetThread, useThread,
} from "./thread-store";

afterEach(() => {
  resetThread("a");
  resetThread("b");
});

describe("thread-store", () => {
  it("isolates messages per thread id", () => {
    appendMessage("a", { role: "user", text: "hi a" });
    appendMessage("b", { role: "user", text: "hi b" });
    expect(getThread("a")).toHaveLength(1);
    expect(getThread("a")[0].text).toBe("hi a");
    expect(getThread("b")[0].text).toBe("hi b");
  });

  it("returns a stable empty array for unknown threads", () => {
    expect(getThread("missing")).toEqual([]);
    expect(getThread("missing")).toBe(getThread("missing"));
  });

  it("resetThread clears a thread", () => {
    appendMessage("a", { role: "user", text: "hi" });
    resetThread("a");
    expect(getThread("a")).toHaveLength(0);
  });

  it("useThread re-renders subscribers on append and restores after remount", () => {
    function View() {
      const messages = useThread("a");
      return <div data-testid="count">{messages.length}</div>;
    }
    const { unmount } = render(<View />);
    expect(screen.getByTestId("count").textContent).toBe("0");
    act(() => appendMessage("a", { role: "user", text: "persisted" }));
    expect(screen.getByTestId("count").textContent).toBe("1");
    unmount();
    // Store survives unmount; a fresh mount reads the same thread.
    render(<View />);
    expect(screen.getByTestId("count").textContent).toBe("1");
  });
});
