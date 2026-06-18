import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./color-picker";

describe("ColorPicker", () => {
  it("renders the current hex value in the text input", () => {
    render(<ColorPicker value="#138BC8" onChange={() => {}} label="Primary" />);
    expect(screen.getByLabelText("Primary")).toHaveValue("#138BC8");
  });
  it("normalizes and calls onChange on blur of a valid hex", async () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} label="Primary" />);
    const input = screen.getByLabelText("Primary");
    await userEvent.clear(input);
    await userEvent.type(input, "fff");
    await userEvent.tab();
    expect(onChange).toHaveBeenCalledWith("#FFFFFF");
  });
  it("shows an error and does not call onChange for invalid hex", async () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} label="Primary" />);
    const input = screen.getByLabelText("Primary");
    await userEvent.clear(input);
    await userEvent.type(input, "zzz");
    await userEvent.tab();
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText(/valid hex/i)).toBeInTheDocument();
  });
});
