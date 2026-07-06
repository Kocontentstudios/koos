import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { StepBasics } from "./step-basics";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

describe("StepBasics AI assist", () => {
  it("renders a Suggest button for the overview field", () => {
    render(<StepBasics state={{ ...DEFAULT_STATE }} onChange={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: /suggest with ai/i }),
    ).toBeInTheDocument();
  });
});
