import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { StepVisual } from "./step-visual";

function renderStep(
  additionalColors: string[] = [],
  additionalColorLabels: string[] = [],
) {
  const onChange = vi.fn();
  render(
    <StepVisual
      state={{ ...DEFAULT_STATE, additionalColors, additionalColorLabels }}
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
    // Seeded empty, not blue: an untouched row must not persist a colour the
    // user never chose. saveBrandProfile drops blanks via parseAdditionalColors.
    expect(onChange).toHaveBeenCalledWith({ additionalColors: [""] });
  });

  it("appends rather than replacing when colors already exist", async () => {
    const onChange = renderStep(["#AA0000"]);
    await userEvent.click(addButton());
    expect(onChange).toHaveBeenCalledWith({
      additionalColors: ["#AA0000", ""],
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
      screen.getByRole("button", { name: "Remove Additional 2" }),
    );
    /* The labels move with their colours. Left behind, the name of the
       removed swatch would reattach to whatever is added next. */
    expect(onChange).toHaveBeenCalledWith({
      additionalColors: ["#AA0000", "#CC0000"],
      additionalColorLabels: ["", ""],
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
      screen.getByRole("button", { name: "Remove Additional 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Additional 2" }),
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

  it("names each swatch as a colour picker", () => {
    renderStep();
    for (const name of ["Pick Primary color", "Pick Secondary color"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });
});

/* ── KOOS-FEAT-021 ─────────────────────────────────────────────────────── */

describe("renaming an additional colour", () => {
  const rename = async (from: string, to: string) => {
    await userEvent.click(screen.getByRole("button", { name: from }));
    const input = screen.getByRole("textbox", { name: /name for/i });
    await userEvent.clear(input);
    if (to) await userEvent.type(input, to);
    await userEvent.keyboard("{Enter}");
  };

  it("offers a rename control on every colour", () => {
    renderStep(["#AA0000", "#BB0000"]);
    expect(
      screen.getByRole("button", { name: "Rename Additional 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename Additional 2" }),
    ).toBeInTheDocument();
  });

  it("stores the name the user typed", async () => {
    const onChange = renderStep(["#AA0000", "#BB0000"]);
    await rename("Rename Additional 1", "Accent");
    expect(onChange).toHaveBeenLastCalledWith({
      additionalColorLabels: ["Accent", ""],
    });
  });

  it("renames only the colour that was clicked", async () => {
    const onChange = renderStep(["#AA0000", "#BB0000"]);
    await rename("Rename Additional 2", "CTA");
    expect(onChange).toHaveBeenLastCalledWith({
      additionalColorLabels: ["", "CTA"],
    });
  });

  /* Escape has to be a way out, or the only exit from the field is to commit
     something. */
  it("keeps the old name when the edit is cancelled", async () => {
    const onChange = renderStep(["#AA0000"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Rename Additional 1" }),
    );
    await userEvent.type(
      screen.getByRole("textbox", { name: /name for/i }),
      "Accent",
    );
    await userEvent.keyboard("{Escape}");
    expect(onChange).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Rename Additional 1" }),
    ).toBeInTheDocument();
  });

  /* The ticket asks that an empty label is prevented or given a sensible
     fallback. Clearing it restores the positional default rather than
     leaving a nameless swatch. */
  it("falls back to the default name when cleared", async () => {
    const onChange = renderStep(["#AA0000"], ["Accent"]);
    await rename("Rename Accent", "");
    expect(onChange).toHaveBeenLastCalledWith({
      additionalColorLabels: [""],
    });
  });

  /* "Additional 1" is the app's word, not the user's. Prefilling it makes
     them clear it before they can type, and typing after it produces
     "Additional 1Accent". */
  it("opens empty when the colour has no name yet", async () => {
    renderStep(["#AA0000"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Rename Additional 1" }),
    );
    expect(screen.getByRole("textbox", { name: /name for/i })).toHaveValue("");
  });

  it("opens with the existing name when there is one, ready to edit", async () => {
    renderStep(["#AA0000"], ["Accent"]);
    await userEvent.click(
      screen.getByRole("button", { name: "Rename Accent" }),
    );
    expect(screen.getByRole("textbox", { name: /name for/i })).toHaveValue(
      "Accent",
    );
  });

  it("shows a stored name instead of the positional one", () => {
    renderStep(["#AA0000", "#BB0000"], ["Accent"]);
    expect(
      screen.getByRole("button", { name: "Rename Accent" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Rename Additional 2" }),
    ).toBeInTheDocument();
  });

  /* The custom name becomes the colour's accessible name everywhere it is
     referenced, which is what the ticket asks for. */
  it("names the swatch and its remove control by the custom label", () => {
    renderStep(["#AA0000"], ["Accent"]);
    expect(
      screen.getByRole("button", { name: /Pick Accent color/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove Accent" }),
    ).toBeInTheDocument();
  });

  /* Two accents is a legitimate brand, so duplicates are allowed on purpose
     rather than validated away. */
  it("allows two colours to share a name", () => {
    renderStep(["#AA0000", "#BB0000"], ["Accent", "Accent"]);
    expect(
      screen.getAllByRole("button", { name: "Rename Accent" }),
    ).toHaveLength(2);
  });
});

/* KOS-V1-FEAT-022. The only font-file input used to live inside conversational
   onboarding, so a brand whose typeface was unusable was told by the
   KOS-V1-BUG-018 notification to re-upload it somewhere that did not exist.
   These pin the control onto the form a user can actually return to. */
describe("StepVisual brand fonts", () => {
  function renderWithFonts(state: Partial<typeof DEFAULT_STATE> = {}) {
    const onChange = vi.fn();
    render(
      <StepVisual state={{ ...DEFAULT_STATE, ...state }} onChange={onChange} />,
    );
    return onChange;
  }

  const STORED = "https://cdn.example.com/fonts/u1/1736-a1b2c3.ttf";
  /* Anchored: the remove buttons are now named "Remove heading / main font",
     so an unanchored pattern matches the control AND the button that deletes
     what it holds. */
  const HEADING = /^heading \/ main font$/i;
  const BODY = /^body \/ cta font$/i;

  it("offers both font slots", () => {
    renderWithFonts();
    expect(screen.getByLabelText(HEADING)).toBeInTheDocument();
    expect(screen.getByLabelText(BODY)).toBeInTheDocument();
  });

  /* Still reachable once a font is attached. FileUpload used to render its
     input only while empty, which left both labels pointing at nothing in
     exactly the state this feature exists for. */
  it("keeps both slots labelled once fonts are attached", () => {
    renderWithFonts({ brandFontUrl: STORED, bodyFontUrl: STORED });
    expect(screen.getByLabelText(HEADING)).toBeInTheDocument();
    expect(screen.getByLabelText(BODY)).toBeInTheDocument();
  });

  it.each([[HEADING], [BODY]])(
    "accepts only the formats the renderer can open on %s",
    (label) => {
      renderWithFonts();
      const accept = screen.getByLabelText(label).getAttribute("accept") ?? "";
      expect(accept).toContain(".ttf");
      expect(accept).toContain(".otf");
      /* Satori refuses every TrueType collection, so offering it would only
         move the failure into the render where nothing names the font. */
      expect(accept).not.toContain(".ttc");
    },
  );

  /* A brand that already has a font must not look as though it has none —
     otherwise the user cannot tell whether their upload ever took. */
  it("shows that a stored font is set", () => {
    renderWithFonts({ brandFontUrl: STORED });
    expect(screen.getByText(/current font \(\.ttf\)/i)).toBeInTheDocument();
  });

  it("leaves an unset slot empty", () => {
    renderWithFonts({ brandFontUrl: "" });
    expect(screen.queryByText(/current font/i)).not.toBeInTheDocument();
  });

  /* Two slots means two remove buttons, and "Remove file" twice tells neither
     a screen reader nor this test which font is about to go. */
  it("names each remove control by the font it removes", () => {
    renderWithFonts({ brandFontUrl: STORED, bodyFontUrl: STORED });
    expect(
      screen.getByRole("button", { name: /remove heading \/ main font/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /remove body \/ cta font/i }),
    ).toBeInTheDocument();
  });

  /* An empty string is the user removing the font, and it has to reach the
     server: omission means "leave it alone" there, so removal would silently
     do nothing (KOS-V1-BUG-020). */
  it("clears the stored font when the slot is removed", async () => {
    const onChange = renderWithFonts({
      brandFontUrl: STORED,
      bodyFontUrl: STORED,
    });

    await userEvent.click(
      screen.getByRole("button", { name: /remove heading \/ main font/i }),
    );

    expect(onChange).toHaveBeenCalledWith({ brandFontUrl: "" });
  });
});
