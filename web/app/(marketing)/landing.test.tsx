import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/lib/i18n/messages/en.json";
import { Landing } from "./_components/landing";

function renderLanding() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Landing />
    </NextIntlClientProvider>,
  );
}

describe("landing page", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: "received" }), { status: 202 }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders one h1 and every act heading", () => {
    renderLanding();

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const heading of [
      messages.marketing.capture.heading,
      messages.marketing.sources.heading,
      messages.marketing.confirm.heading,
      messages.marketing.ledger.heading,
      messages.marketing.understand.heading,
      messages.marketing.apply.heading,
    ]) {
      expect(screen.getAllByRole("heading", { name: heading }).length).toBeGreaterThan(0);
    }
  });

  // The scene is keyed to these: `data-act` positions drive the camera, and the
  // two `data-band` sections are the sideways stretches. Adding a section
  // without giving it one silently desynchronises the film from the page.
  it("keeps six acts and two bands, each tagged for the scene", () => {
    const { container } = renderLanding();

    const sections = container.querySelectorAll("main > section");
    expect(sections).toHaveLength(8);
    expect(container.querySelectorAll("main > section[data-act]")).toHaveLength(6);
    expect(container.querySelectorAll("main > section[data-band]")).toHaveLength(2);

    // The act indices must be 0..5 in document order, because the engine
    // interpolates between neighbours by position in that list.
    const acts = [...container.querySelectorAll("[data-act]")].map((el) =>
      el.getAttribute("data-act"),
    );
    expect(acts).toEqual(["0", "1", "2", "3", "4", "5"]);

    // One tick per act, or the index down the edge points at the wrong thing.
    expect(container.querySelectorAll("[data-tick]")).toHaveLength(6);
  });

  // Each band's rail is what the engine translates. No rail, no travel — the
  // section becomes 300vh of nothing moving.
  it("gives every band a rail to translate", () => {
    const { container } = renderLanding();
    const bands = [...container.querySelectorAll("[data-band]")];
    expect(bands).toHaveLength(2);
    for (const band of bands) {
      expect(band.querySelector("[data-rail]")).not.toBeNull();
    }
  });

  it("routes the primary calls to action at the invite form, not signup", () => {
    const { container } = renderLanding();
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    // The invite form is the destination — signing up needs a code first — and
    // the section it lives in has to be anchorable, because the nav's
    // `Request access` targets it from here and from every other public route.
    expect(container.querySelector("#apply")).not.toBeNull();
    // The one signup link is for people who already hold a code.
    expect(hrefs).toContain("/login?mode=signup");
  });

  it("links the legal pages and the roadmap from the footer", () => {
    const { container } = renderLanding();
    const footer = container.querySelector("footer")!;
    const hrefs = [...footer.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/terms");
    // The unbuilt-features list lives there now, not in the footer copy itself.
    expect(hrefs).toContain("/roadmap");
  });

  // Claim guard. The page must never present these as things the product does:
  // Gmail ingestion returns 410, web push delivers nothing, WebAuthn is
  // unimplemented, and shared workspaces were removed. The honest accounting
  // lives at /roadmap, so there is no disclosure block here to exempt.
  it("makes no claim the product cannot keep", () => {
    const { container } = renderLanding();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["gmail", "passkey", "webauthn", "push notification"]) {
      expect(text).not.toContain(banned);
    }
  });

  // The old copy sold a self-hosted stack. It is a paid product now, and every
  // "your own deployment" line was a reason for a buyer to close the tab.
  it("does not pitch itself as self-hosted", () => {
    const { container } = renderLanding();
    const text = (container.textContent ?? "").toLowerCase();
    for (const banned of ["self-hosted", "your own deployment", "llm gateway"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("says it is a closed beta before it asks for anything", () => {
    renderLanding();
    expect(screen.getAllByText(messages.marketing.hero.badge).length).toBeGreaterThan(0);
  });

  // Both the hero figure and the ledger are invented money. A record keeper that
  // shows a fake balance without saying so has already lost the argument.
  it("labels every made-up figure as sample data", () => {
    const { container } = renderLanding();
    const figures = container.querySelectorAll("figure");
    expect(figures.length).toBe(2);
    figures.forEach((figure) => {
      expect(figure.querySelector("figcaption")?.textContent).toBe(
        messages.marketing.hero.sample,
      );
    });
  });

  it("describes Plaid as a scheduled sync, never as real time", () => {
    const { container } = renderLanding();
    const text = (container.textContent ?? "").toLowerCase();
    expect(text).toContain("six hours");
    expect(text).not.toContain("real-time");
    expect(text).not.toContain("real time");
    expect(text).not.toContain("nightly");
  });

  it("posts an application and swaps the form for a confirmation", async () => {
    renderLanding();

    fireEvent.change(screen.getByLabelText(messages.marketing.apply.email), {
      target: { value: "sam@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.marketing.apply.submit }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: messages.marketing.apply.doneTitle }),
      ).toBeInTheDocument();
    });

    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/beta/apply");
    expect(JSON.parse(String(init.body)).email).toBe("sam@example.com");
    // The form is gone, so a second submission can't be fired by accident.
    expect(
      screen.queryByRole("button", { name: messages.marketing.apply.submit }),
    ).not.toBeInTheDocument();
  });

  // The optional fields are collected when offered but never demanded: the
  // server takes all three as null, so a bare email is a complete application.
  it("sends the optional details when they are filled in", async () => {
    renderLanding();

    fireEvent.change(screen.getByLabelText(messages.marketing.apply.email), {
      target: { value: "sam@example.com" },
    });
    fireEvent.change(screen.getByLabelText(messages.marketing.apply.country), {
      target: { value: "gb" },
    });
    fireEvent.click(screen.getByRole("button", { name: messages.marketing.apply.submit }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: messages.marketing.apply.doneTitle }),
      ).toBeInTheDocument();
    });

    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(String(init.body));
    expect(body.country).toBe("GB");
    expect(body.name).toBeNull();
    expect(body.how_you_track_money).toBeNull();
  });
});
