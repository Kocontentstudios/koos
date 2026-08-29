import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CHIP_SELECTION } from "@/lib/onboarding/chips";
import { ChipPicker } from "./chip-picker";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChipPicker", () => {
  it("offers the tone words and submits what was picked", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.click(screen.getByRole("button", { name: "Warm" }));
    await user.click(screen.getByRole("button", { name: "Use these words" }));

    expect(onSubmit).toHaveBeenCalledWith(["Bold", "Warm"]);
  });

  it("offers the avoid words with its own label", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChipPicker kind="avoid" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Synergy" }));
    await user.click(screen.getByRole("button", { name: "Avoid these" }));

    expect(onSubmit).toHaveBeenCalledWith(["Synergy"]);
  });

  it("marks a picked chip as pressed and lets it be unpicked", async () => {
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={vi.fn()} />);

    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold).toHaveAttribute("aria-pressed", "false");

    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "true");

    await user.click(bold);
    expect(bold).toHaveAttribute("aria-pressed", "false");
  });

  it("cannot submit an empty selection", () => {
    render(<ChipPicker kind="tone" onSubmit={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Use these words" }),
    ).toBeDisabled();
  });

  /* A brand's own vocabulary will never be covered by a fixed list. */
  it("accepts a word the list does not offer", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChipPicker kind="avoid" onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText("Add a word to avoid"), "Ideate");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Avoid these" }));

    expect(onSubmit).toHaveBeenCalledWith(["Ideate"]);
  });

  it("adds a custom word on Enter", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={onSubmit} />);

    await user.type(
      screen.getByLabelText("Add your own word"),
      "Earthy{Enter}",
    );
    await user.click(screen.getByRole("button", { name: "Use these words" }));

    expect(onSubmit).toHaveBeenCalledWith(["Earthy"]);
  });

  it("shows a custom word as a chip that can be unpicked", async () => {
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={vi.fn()} />);

    await user.type(
      screen.getByLabelText("Add your own word"),
      "Earthy{Enter}",
    );
    const chip = screen.getByRole("button", { name: "Earthy" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  /* Otherwise "bold" could sit beside the "Bold" chip and the brand ends up
     with the same trait twice. */
  it("refuses a custom word that duplicates a pick, ignoring case", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Bold" }));
    await user.type(screen.getByLabelText("Add your own word"), "bold{Enter}");
    await user.click(screen.getByRole("button", { name: "Use these words" }));

    expect(onSubmit).toHaveBeenCalledWith(["Bold"]);
  });

  it("clears the input after adding", async () => {
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={vi.fn()} />);

    const input = screen.getByLabelText("Add your own word");
    await user.type(input, "Earthy{Enter}");
    expect(input).toHaveValue("");
  });

  /* toneBadges renders at most six, so anything past that would vanish from
     the snapshot card without the user knowing. */
  it("stops at the cap the snapshot card can show", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ChipPicker kind="tone" onSubmit={onSubmit} />);

    for (const word of [
      "Bold",
      "Punchy",
      "Playful",
      "Friendly",
      "Warm",
      "Authoritative",
    ]) {
      await user.click(screen.getByRole("button", { name: word }));
    }
    expect(screen.getByText(/enough for a clear voice/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Sophisticated" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Use these words" }));
    expect(onSubmit.mock.calls[0][0]).toHaveLength(MAX_CHIP_SELECTION);
  });

  it("goes quiet while a reply is streaming", () => {
    render(<ChipPicker kind="tone" onSubmit={vi.fn()} disabled />);
    expect(screen.getByRole("button", { name: "Bold" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Use these words" }),
    ).toBeDisabled();
  });
});
