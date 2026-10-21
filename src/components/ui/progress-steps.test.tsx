import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressSteps } from "./progress-steps";

const STEPS = ["Business Basics", "Brand Direction", "Brand Assets"];
const RUN = ["Brief", "Imagery", "Layout", "Checks"];

function connectors(container: HTMLElement) {
  return [
    ...container.querySelectorAll<HTMLElement>(
      '[data-slot="progress-connector"]',
    ),
  ];
}

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

  /* Round 3: connectors took their length from label widths, so "Brief" to
     "Imagery" was twice "Imagery" to "Layout". jsdom has no layout, so the
     structure that guarantees equal lengths is what is held here: equal
     columns and one centre-to-centre geometry for every connector. */
  it("lays the steps out as equal columns with identical connectors", () => {
    const { container } = render(<ProgressSteps steps={RUN} current={2} />);
    expect(screen.getByRole("list")).toHaveClass(
      "grid",
      "grid-flow-col",
      "auto-cols-[minmax(0,1fr)]",
    );
    const lines = connectors(container);
    expect(lines).toHaveLength(3);
    const geometry = (el: HTMLElement) =>
      el.className
        .split(" ")
        .filter((c) => !c.startsWith("bg-"))
        .join(" ");
    expect(new Set(lines.map(geometry)).size).toBe(1);
    expect(geometry(lines[0])).toContain("left-[calc(-50%+16px)]");
    expect(geometry(lines[0])).toContain("right-[calc(50%+16px)]");
  });

  it("fills the connectors up to the current step", () => {
    const { container } = render(<ProgressSteps steps={RUN} current={2} />);
    expect(
      connectors(container).map((el) => el.hasAttribute("data-reached")),
    ).toEqual([true, true, false]);
  });
});
