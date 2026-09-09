import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { CampaignCard } from "@/lib/strategy/campaign-card";
import { StrategyCard } from "./strategy-card";

const campaign: CampaignCard = {
  id: "s1",
  campaignName: "Ramadan Gift Bundles",
  objective: "Sell 500 gift bundles before Eid",
  channels: ["Instagram", "WhatsApp", "Meta Ads"],
  phaseCount: 4,
  timelineSpan: "Tease → Last call",
  status: "draft",
};

function renderCard(overrides: Partial<CampaignCard> = {}, props = {}) {
  const handlers = {
    onOpen: vi.fn(),
    onReview: vi.fn(),
    onSave: vi.fn(),
    onGenerateCalendar: vi.fn(),
  };
  render(
    <StrategyCard
      campaign={{ ...campaign, ...overrides }}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("StrategyCard", () => {
  it("leads with the campaign name so the chat's focus is scannable", () => {
    renderCard();
    expect(
      screen.getByRole("heading", { name: "Ramadan Gift Bundles" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Sell 500 gift bundles before Eid"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Instagram, WhatsApp, Meta Ads"),
    ).toBeInTheDocument();
    expect(screen.getByText("4 phases: Tease → Last call")).toBeInTheDocument();
  });

  /* An article labelled BY the heading, not a landmark region duplicating the
     name — a chat attachment does not belong in the landmarks rotor. */
  it("names itself from its heading without double-announcing", () => {
    renderCard();
    expect(
      screen.getByRole("article", { name: "Ramadan Gift Bundles" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /Campaign strategy/ }),
    ).not.toBeInTheDocument();
  });

  it("offers Open, Review and Save on a draft campaign", async () => {
    const user = userEvent.setup();
    const h = renderCard();

    await user.click(screen.getByRole("button", { name: /^Open strategy/ }));
    expect(h.onOpen).toHaveBeenCalledWith("s1");

    await user.click(screen.getByRole("button", { name: /^Review strategy/ }));
    expect(h.onReview).toHaveBeenCalledWith("s1");

    await user.click(screen.getByRole("button", { name: /^Save strategy/ }));
    expect(h.onSave).toHaveBeenCalledWith("s1");
  });

  /* Absence of a badge is not a signal: without an explicit Draft the user
     cannot tell the campaign is uncommitted, so Save means nothing. */
  it("labels an uncommitted campaign Draft and offers no calendar action", () => {
    renderCard();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Generate Calendar for/ }),
    ).not.toBeInTheDocument();
  });

  /* Regression: Save and Generate Calendar used to be two keyed buttons, so
     committing unmounted the focused element and dropped keyboard focus to the
     document body — the user had to Tab from the top of the page to reach the
     next step. One element across both states keeps focus. */
  it("keeps keyboard focus on the primary action across the commit", () => {
    const handlers = {
      onOpen: vi.fn(),
      onReview: vi.fn(),
      onSave: vi.fn(),
      onGenerateCalendar: vi.fn(),
    };
    const { rerender } = render(
      <StrategyCard campaign={campaign} {...handlers} />,
    );
    const save = screen.getByRole("button", { name: /^Save strategy/ });
    save.focus();
    expect(document.activeElement).toBe(save);

    rerender(
      <StrategyCard
        campaign={{ ...campaign, status: "active" }}
        {...handlers}
      />,
    );
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveAccessibleName(
      /Generate Calendar for/,
    );
  });

  /* WCAG 2.5.3: a voice-control user says the visible label, so the accessible
     name has to contain it. "Generate content calendar for X" did not. */
  it("keeps each visible label inside its accessible name", () => {
    renderCard({ status: "active" });
    for (const visible of ["Open", "Review", "Generate Calendar"]) {
      expect(
        screen.getByRole("button", { name: new RegExp(visible) }),
      ).toHaveTextContent(visible);
    }
  });

  /* Regression: the boundary was set with a `border-[…]` utility, which loses
     to globals.css's unlayered `* { border-color: var(--border) }` — the
     buttons rendered at 1.23:1 while a code comment claimed 3:1. Assert the
     mechanism that survives the cascade, not the class name. */
  it("sets the control boundary where the cascade cannot override it", () => {
    renderCard();
    for (const name of [/^Open strategy/, /^Review strategy/]) {
      const button = screen.getByRole("button", { name });
      expect(button.style.borderColor).toBe("var(--border-control)");
    }
  });

  /* Regression: the sr-only status is position:absolute. Without `relative` on
     the card its containing block became the document, and the page grew to
     ~5000px behind a chat that is supposed to scroll internally. */
  it("contains its absolutely-positioned status announcement", () => {
    renderCard({ status: "active" });
    const card = screen.getByRole("article");
    expect(card.className).toContain("relative");
    expect(card.contains(screen.getByRole("status"))).toBe(true);
  });

  it("outlines the card itself the same way", () => {
    renderCard();
    expect(screen.getByRole("article").style.borderColor).toBe(
      "var(--border-accent)",
    );
  });

  it("distinguishes Review's busy text from Open's", () => {
    renderCard({}, { reviewing: true });
    expect(screen.getByText("Adding recap…")).toBeInTheDocument();
    expect(screen.queryByText("Opening…")).not.toBeInTheDocument();
  });

  /* The transcript is already a role="log" live region (message-list), so the
     announcement is one hidden status naming what actually changed, not a
     nested live region re-reading the card's static label. */
  it("announces what the commit changed, not just the badge", () => {
    renderCard({ status: "active" });
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(
      "Saved. Generate Calendar is now available for Ramadan Gift Bundles.",
    );
  });

  it("stays silent while the campaign is still a draft", () => {
    renderCard();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  /* Save is the commit. Once committed the next step is the calendar, so the
     Save button gives up its slot rather than sitting there re-savable. */
  it("swaps Save for Generate Calendar once saved", async () => {
    const user = userEvent.setup();
    const h = renderCard({ status: "active" });

    expect(screen.getByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Save strategy/ }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Generate Calendar for/ }),
    );
    expect(h.onGenerateCalendar).toHaveBeenCalled();
  });

  /* One card action at a time. The client refuses a second while one is in
     flight, so the other buttons must LOOK refused — a full-opacity button
     that swallows the click is the same failure as a silent error. */
  it("shows progress on the acting button and refuses the rest visibly", () => {
    renderCard({}, { saving: true });
    expect(screen.getByText("Saving…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Open strategy/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Review strategy/ }),
    ).toBeDisabled();
  });

  it("refuses the secondaries while the calendar is generating", () => {
    renderCard({ status: "active" }, { generatingCalendar: true });
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Open strategy/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /^Review strategy/ }),
    ).toBeDisabled();
  });

  it("leaves every action live when nothing is pending", () => {
    renderCard();
    for (const name of [
      /^Open strategy/,
      /^Review strategy/,
      /^Save strategy/,
    ]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
  });

  it("omits a meta line rather than leaving a gap when it has nothing to say", () => {
    renderCard({ channels: [], phaseCount: 0, timelineSpan: "" });
    expect(screen.queryByText(/phase/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Ramadan Gift Bundles" }),
    ).toBeInTheDocument();
  });

  it("announces a failed action without losing the card", () => {
    renderCard({}, { error: "Could not save strategy." });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Could not save strategy.",
    );
    expect(
      screen.getByRole("heading", { name: "Ramadan Gift Bundles" }),
    ).toBeInTheDocument();
  });

  /* At 360px three side-by-side actions overflow unless the row wraps and the
     card is allowed to be full-width. jsdom can't measure, so the contract is
     asserted on the classes that carry it. */
  it("stays usable on a narrow screen", () => {
    renderCard();
    const card = screen.getByRole("article");
    expect(card.className).toContain("w-full");
    expect(card.className).toContain("sm:max-w-[480px]");

    const actions = screen.getByRole("button", {
      name: /^Open strategy/,
    }).parentElement;
    expect(actions?.className).toContain("flex-wrap");
  });

  it("clamps a long objective instead of pushing the actions off-card", () => {
    renderCard({ objective: "x".repeat(400) });
    expect(screen.getByText("x".repeat(400)).className).toContain(
      "line-clamp-2",
    );
  });
});
