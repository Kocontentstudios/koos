import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Strategy } from "@/lib/ai/strategy-schema";
import { StrategyCard } from "./strategy-card";

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

describe("StrategyCard", () => {
  it("shows the campaign name and key sections", () => {
    render(<StrategyCard strategy={S} />);
    expect(screen.getByText("The Fresh Drop")).toBeInTheDocument();
    expect(screen.getByText(/Drive 300/)).toBeInTheDocument();
    expect(screen.getByText("Instagram")).toBeInTheDocument();
  });
  it("fires onGenerateCalendar when the primary button is clicked", async () => {
    const onGen = vi.fn();
    render(<StrategyCard strategy={S} onGenerateCalendar={onGen} />);
    await userEvent.click(
      screen.getByRole("button", { name: /generate calendar/i }),
    );
    expect(onGen).toHaveBeenCalled();
  });
  it("disables the generate button while generating", () => {
    render(
      <StrategyCard strategy={S} generating onGenerateCalendar={() => {}} />,
    );
    expect(
      screen.getByRole("button", { name: /generating|generate calendar/i }),
    ).toBeDisabled();
  });
});
