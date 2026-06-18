import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressSteps } from "./progress-steps";

const STEPS = ["Business Basics", "Brand Direction", "Brand Assets"];

describe("ProgressSteps", () => {
  it("renders all step labels", () => {
    render(<ProgressSteps steps={STEPS} current={1} />);
    for (const s of STEPS) expect(screen.getByText(s)).toBeInTheDocument();
  });
  it("marks the current step with aria-current", () => {
    render(<ProgressSteps steps={STEPS} current={1} />);
    expect(screen.getByText("Brand Direction").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
  });
});
