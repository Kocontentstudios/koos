import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TourCard } from "./tour-card";

function renderCard(overrides: Partial<Parameters<typeof TourCard>[0]> = {}) {
  const props = {
    title: "Your Dashboard",
    body: "This is your main workspace.",
    step: 3,
    total: 7,
    primaryLabel: "Next",
    secondaryLabel: "Back",
    titleId: "t",
    bodyId: "b",
    onPrimary: vi.fn(),
    onSecondary: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TourCard {...props} />);
  return props;
}

describe("TourCard", () => {
  it("shows the step title as a heading", () => {
    renderCard();
    expect(
      screen.getByRole("heading", { name: "Your Dashboard" }),
    ).toBeInTheDocument();
  });

  it("shows the position in the tour", () => {
    renderCard();
    expect(screen.getByText("3 of 7")).toBeInTheDocument();
  });

  it("omits the position on the opening prompt", () => {
    renderCard({ step: null });
    expect(screen.queryByText(/of 7/)).toBeNull();
  });

  it("omits the secondary action rather than disabling it", () => {
    renderCard({ secondaryLabel: undefined, onSecondary: undefined });
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("reports primary, secondary and close clicks", async () => {
    const props = renderCard();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(props.onPrimary).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(props.onSecondary).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Close tour" }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it("focuses the primary action so Enter advances the tour", () => {
    renderCard();
    expect(screen.getByRole("button", { name: "Next" })).toHaveFocus();
  });
});
