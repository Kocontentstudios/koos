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
});
