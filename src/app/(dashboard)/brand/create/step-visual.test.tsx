import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { StepVisual } from "./step-visual";

function renderStep(additionalColors: string[] = []) {
  const onChange = vi.fn();
  render(
    <StepVisual
      state={{ ...DEFAULT_STATE, additionalColors }}
      onChange={onChange}
    />,
  );
  return onChange;
}

const addButton = () => screen.getByRole("button", { name: /add color/i });

describe("StepVisual additional colors", () => {
  it("adds a color to the list", async () => {
    const onChange = renderStep();
    await userEvent.click(addButton());
    expect(onChange).toHaveBeenCalledWith({ additionalColors: ["#138BC8"] });
  });

  it("appends rather than replacing when colors already exist", async () => {
    const onChange = renderStep(["#AA0000"]);
    await userEvent.click(addButton());
    expect(onChange).toHaveBeenCalledWith({
      additionalColors: ["#AA0000", "#138BC8"],
    });
  });

  it("hides the add button at the cap of 3", () => {
    renderStep(["#AA0000", "#BB0000", "#CC0000"]);
    expect(
      screen.queryByRole("button", { name: /add color/i }),
    ).not.toBeInTheDocument();
  });

  it("removes the row the user clicked, not the last one", async () => {
    const onChange = renderStep(["#AA0000", "#BB0000", "#CC0000"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Remove additional color 2" }),
    );
    expect(onChange).toHaveBeenCalledWith({
      additionalColors: ["#AA0000", "#CC0000"],
    });
  });

  it("edits only the targeted row", async () => {
    const onChange = renderStep(["#AA0000", "#BB0000"]);
    const input = screen.getByDisplayValue("#BB0000");
    await userEvent.clear(input);
    await userEvent.type(input, "#00FF00");
    await userEvent.tab();
    expect(onChange).toHaveBeenLastCalledWith({
      additionalColors: ["#AA0000", "#00FF00"],
    });
  });

  it("renders duplicate hexes as two independent rows", () => {
    renderStep(["#AA0000", "#AA0000"]);
    expect(screen.getAllByDisplayValue("#AA0000")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Remove additional color 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove additional color 2" }),
    ).toBeInTheDocument();
  });

  it("survives a corrupted localStorage draft holding a non-array", () => {
    const onChange = vi.fn();
    render(
      <StepVisual
        state={
          {
            ...DEFAULT_STATE,
            additionalColors: "not-an-array",
          } as never
        }
        onChange={onChange}
      />,
    );
    expect(addButton()).toBeInTheDocument();
  });
});
