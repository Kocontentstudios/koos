import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const captureEvent = vi.fn();
const design = {
  generate: vi.fn(async () => []),
  retry: vi.fn(),
  pending: false,
  progressLabel: null,
  stage: null,
  progress: null,
  jobStage: null,
  error: null,
  partial: null,
  failedCount: 0,
  failedIds: [],
  generations: [],
  reset: vi.fn(),
};

vi.mock("./use-design-generation", () => ({
  useDesignGeneration: () => design,
}));
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (...a: unknown[]) => captureEvent(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GenerateDesignButton } from "./generate-design-button";

beforeEach(() => {
  vi.clearAllMocks();
  design.pending = false;
});

async function chooseKo() {
  await userEvent.click(screen.getByRole("button", { name: /Generate/ }));
  await userEvent.click(
    await screen.findByRole("button", { name: /let ko create the imagery/i }),
  );
}

/* Design generation is one of the longest waits in the product. The button
   swapped its own label but never showed a spinner or set aria-busy, so it
   was the one slow action whose pending state didn't match the rest. */
describe("GenerateDesignButton", () => {
  it("is idle and actionable before a run", () => {
    render(<GenerateDesignButton brandId="b1" />);
    const button = screen.getByRole("button", { name: /Generate/ });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("spins, announces busy and refuses a second click while generating", async () => {
    design.pending = true;
    const { container } = render(<GenerateDesignButton brandId="b1" />);
    const button = screen.getByRole("button", { name: /Generating…/ });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    await userEvent.click(button);
    expect(
      screen.queryByRole("button", { name: /use a specific image/i }),
    ).toBeNull();
    expect(design.generate).not.toHaveBeenCalled();
  });

  /* Every entry point goes through this button, so none can skip the image
     choice: nothing is generated or billed until the imagery is picked. */
  it("opens the image choice without generating anything", async () => {
    render(<GenerateDesignButton brandId="b1" briefId="brief-1" />);
    await userEvent.click(screen.getByRole("button", { name: /Generate/ }));
    expect(
      await screen.findByRole("button", { name: /use a specific image/i }),
    ).toBeInTheDocument();
    expect(design.generate).not.toHaveBeenCalled();
  });

  it("generates with the chosen imagery and the caller's ids", async () => {
    render(<GenerateDesignButton brandId="b1" briefId="brief-1" />);
    await chooseKo();
    expect(design.generate).toHaveBeenCalledWith({
      brandId: "b1",
      briefId: "brief-1",
      image: { source: "ko" },
    });
  });

  it.each([
    [{ calendarItemId: "c1" }, "calendar"],
    [{ briefId: "brief-1" }, "brief"],
    [{}, "studio"],
  ])("records the entry point it was opened from (%o)", async (ids, entry) => {
    render(<GenerateDesignButton brandId="b1" {...ids} />);
    await chooseKo();
    expect(captureEvent).toHaveBeenCalledWith("design_image_choice", {
      source: "ko",
      entry,
    });
  });

  it("resets the run when the dialog closes", async () => {
    render(<GenerateDesignButton brandId="b1" />);
    await userEvent.click(screen.getByRole("button", { name: /Generate/ }));
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(design.reset).toHaveBeenCalled();
  });
});
