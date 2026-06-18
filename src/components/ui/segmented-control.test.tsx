import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SegmentedControl } from "./segmented-control";

const OPTIONS = [
  { label: "Month", value: "month" },
  { label: "Week", value: "week" },
];

describe("SegmentedControl", () => {
  it("marks the active option with aria-pressed", () => {
    render(
      <SegmentedControl options={OPTIONS} value="week" onChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Week" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Month" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
  it("calls onChange with the clicked value", async () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl options={OPTIONS} value="week" onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Month" }));
    expect(onChange).toHaveBeenCalledWith("month");
  });
});
