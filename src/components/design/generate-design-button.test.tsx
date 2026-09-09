import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GenerateDesignButton } from "./generate-design-button";

const generate = vi.fn();
let pending = false;

vi.mock("./use-design-generation", () => ({
  useDesignGeneration: () => ({
    generate,
    pending,
    progressLabel: null,
    error: null,
    generations: [],
    reset: vi.fn(),
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

/* Design generation is one of the longest waits in the product. The button
   swapped its own label but never showed a spinner or set aria-busy, so it
   was the one slow action whose pending state didn't match the rest. */
describe("GenerateDesignButton", () => {
  it("is idle and actionable before a run", () => {
    pending = false;
    render(<GenerateDesignButton brandId="b1" />);
    const button = screen.getByRole("button", { name: /Generate/ });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("spins, announces busy and refuses a second click while generating", () => {
    pending = true;
    const { container } = render(<GenerateDesignButton brandId="b1" />);
    const button = screen.getByRole("button", { name: /Generating…/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    pending = false;
  });
});
