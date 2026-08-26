import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { StrategyPanel } from "./strategy-panel";

const S: Strategy = {
  campaignName: "The Fresh Drop",
  objective: "Drive 300+ pre-orders",
  targetAudience: "Women 22-38",
  keyMessage: "Clean beauty in 3 steps",
  channels: [{ name: "Instagram", rationale: "Buzz" }],
  contentMix: [{ type: "Carousel", count: 6 }],
  timeline: [{ phase: "Teaser", dateRange: "Days 1-7", focus: "Anticipation" }],
  themes: [{ title: "BTS", description: "Sourcing" }],
  postingSchedule: [{ channel: "Instagram", cadence: "Tue/Thu" }],
};

function renderPanel(
  overrides: Partial<React.ComponentProps<typeof StrategyPanel>> = {},
) {
  const props = {
    strategy: S,
    collapsed: false,
    onToggleCollapsed: vi.fn(),
    onGenerateCalendar: vi.fn(),
    generating: false,
    calendarError: null,
    mobileOpen: false,
    onMobileClose: vi.fn(),
    onEdit: vi.fn(),
    ...overrides,
  };
  render(<StrategyPanel {...props} />);
  return props;
}

describe("StrategyPanel", () => {
  it("renders an Edit strategy button when a strategy is present and fires onEdit", async () => {
    const props = renderPanel();
    const editButtons = screen.getAllByRole("button", {
      name: /edit strategy/i,
    });
    expect(editButtons.length).toBeGreaterThan(0);
    await userEvent.click(editButtons[0]);
    expect(props.onEdit).toHaveBeenCalled();
  });

  it("does not render Edit strategy when there is no strategy", () => {
    renderPanel({ strategy: null });
    expect(screen.queryByRole("button", { name: /edit strategy/i })).toBeNull();
  });

  /* Regression: reopening a chat restores the campaign card but not the
     structured strategy, so the panel used to say the campaign had never been
     drafted while the card three inches away showed it as Saved. */
  it("points at the card instead of claiming nothing was drafted", () => {
    renderPanel({
      strategy: null,
      emptyMessage:
        "Choose Open on the Ramadan Gift Bundles card to see the full strategy here.",
    });
    expect(
      screen.getAllByText(/Choose Open on the Ramadan Gift Bundles card/)
        .length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText(/once KO drafts a plan/)).not.toBeInTheDocument();
  });

  it("falls back to the never-drafted copy for a chat with no campaign", () => {
    renderPanel({ strategy: null });
    expect(screen.getAllByText(/once KO drafts a plan/).length).toBeGreaterThan(
      0,
    );
  });

  /* Regression: the panel offered Generate Calendar on an uncommitted draft,
     and that path calls saveStrategy() first — so it contradicted the card's
     draft → Save → Generate Calendar model AND committed the draft silently. */
  it("offers Save, not Generate Calendar, while the campaign is a draft", () => {
    const props = renderPanel({ saved: false, onSave: vi.fn() });
    expect(
      screen.getAllByRole("button", { name: /save campaign/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /generate calendar/i }),
    ).not.toBeInTheDocument();
    void props;
  });

  it("offers Generate Calendar once the campaign is saved", () => {
    renderPanel({ saved: true });
    expect(
      screen.getAllByRole("button", { name: /generate calendar/i }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /save campaign/i }),
    ).not.toBeInTheDocument();
  });

  it("fires onSave from the panel's draft action", async () => {
    const props = renderPanel({ saved: false, onSave: vi.fn() });
    await userEvent.click(
      screen.getAllByRole("button", { name: /save campaign/i })[0],
    );
    expect(props.onSave).toHaveBeenCalled();
  });

  /* The panel shares the card's handlers, which refuse a second action. Its
     buttons must look refused too, or a click lands on nothing. */
  it("refuses its actions while a card action is in flight", () => {
    renderPanel({ saved: true, busy: true });
    for (const b of screen.getAllByRole("button", {
      name: /generate calendar/i,
    })) {
      expect(b).toBeDisabled();
    }
  });

  it("refuses its draft Save while a card action is in flight", () => {
    renderPanel({ saved: false, onSave: vi.fn(), busy: true });
    for (const b of screen.getAllByRole("button", { name: /save campaign/i })) {
      expect(b).toBeDisabled();
    }
  });
});
