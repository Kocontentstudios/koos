import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const design = {
  generate: vi.fn(),
  retry: vi.fn(),
  pending: false,
  progressLabel: null,
  stage: null,
  progress: null,
  error: null,
  partial: null,
  failedCount: 0,
  generations: [],
  reset: vi.fn(),
};
vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => design,
}));
vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));

import { GenerateDirectionsButton } from "./generate-directions-button";

beforeEach(() => {
  vi.clearAllMocks();
  design.pending = false;
});

describe("GenerateDirectionsButton", () => {
  it("opens the image choice without generating anything", async () => {
    render(<GenerateDirectionsButton brandId="b1" entry="calendar" />);
    await userEvent.click(
      screen.getByRole("button", { name: /generate design/i }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(design.generate).not.toHaveBeenCalled();
  });

  it("spins and refuses a second click while a run is going", () => {
    design.pending = true;
    render(<GenerateDirectionsButton brandId="b1" entry="calendar" />);
    const button = screen.getByRole("button", { name: /generating/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("resets the run when the dialog closes", async () => {
    render(<GenerateDirectionsButton brandId="b1" entry="studio" />);
    await userEvent.click(
      screen.getByRole("button", { name: /generate design/i }),
    );
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(design.reset).toHaveBeenCalled();
  });
});
