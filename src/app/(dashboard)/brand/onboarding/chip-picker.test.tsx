import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CHIP_SELECTION, PLATFORM_CHIPS } from "@/lib/onboarding/chips";
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

  /* "That's 6 — enough for a clear voice" is nonsense under a question about
     what competitors are good at, and the cap message is the only copy in the
     component that is not per-kind by construction. */
  it.each([
    ["tone", /clear voice/i],
    ["avoid", /no-go list/i],
    ["differentiation", /sharp positioning/i],
    ["competitor-strengths", /picture of the field/i],
  ] as const)("names what %s is enough FOR at the cap", async (kind, copy) => {
    const user = userEvent.setup();
    render(<ChipPicker kind={kind} onSubmit={() => {}} />);
    const chips = screen.getAllByRole("button", { pressed: false });
    for (const chip of chips.slice(0, MAX_CHIP_SELECTION)) {
      await user.click(chip);
    }
    expect(screen.getByText(copy)).toBeInTheDocument();
  });

  it.each([
    ["differentiation", "Higher quality"],
    ["competitor-strengths", "Bigger budget"],
  ] as const)("offers the %s options", (kind, option) => {
    render(<ChipPicker kind={kind} onSubmit={() => {}} />);
    expect(screen.getByRole("button", { name: option })).toBeInTheDocument();
  });

  /* Free text is an acceptance criterion: a brand's real edge is usually too
     specific for a fixed list. */
  it("accepts a custom competitive advantage", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<ChipPicker kind="differentiation" onSubmit={onSubmit} />);
    await user.type(
      screen.getByLabelText(/add your own advantage/i),
      "Only cold-pressed in Lagos",
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    await user.click(screen.getByRole("button", { name: /that's our edge/i }));
    expect(onSubmit).toHaveBeenCalledWith(["Only cold-pressed in Lagos"]);
  });
});

describe("single-select polls", () => {
  it("replaces the choice rather than accumulating", async () => {
    const onSubmit = vi.fn();
    render(<ChipPicker kind="primary-platform" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Instagram" }));
    await userEvent.click(screen.getByRole("button", { name: "LinkedIn" }));

    expect(screen.getByRole("button", { name: "Instagram" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "LinkedIn" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("submits the one answer", async () => {
    const onSubmit = vi.fn();
    render(<ChipPicker kind="posting-cadence" onSubmit={onSubmit} />);

    await userEvent.click(screen.getByRole("button", { name: "Daily" }));
    await userEvent.click(screen.getByRole("button", { name: /how often/i }));

    expect(onSubmit).toHaveBeenCalledWith(["Daily"]);
  });

  /* The cap message is about running out of room; a single-select poll has
     room for exactly one by design, which is not the same thing. */
  it("does not tell a single-select poll it is at capacity", async () => {
    render(<ChipPicker kind="primary-platform" onSubmit={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Instagram" }));
    expect(
      screen.queryByText(/enough for a primary channel/i),
    ).not.toBeInTheDocument();
  });
});

describe("multi-select platform poll", () => {
  it("lets a brand pick every channel it is on", async () => {
    const onSubmit = vi.fn();
    render(<ChipPicker kind="platforms" onSubmit={onSubmit} />);

    for (const p of PLATFORM_CHIPS) {
      await userEvent.click(screen.getByRole("button", { name: p }));
    }
    await userEvent.click(screen.getByRole("button", { name: /active on/i }));

    expect(onSubmit).toHaveBeenCalledWith([...PLATFORM_CHIPS]);
  });
});
