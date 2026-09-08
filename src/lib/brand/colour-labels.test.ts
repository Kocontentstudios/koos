import { describe, expect, it } from "vitest";
import {
  alignLabelsToColours,
  defaultColourLabel,
  labelsToStore,
  MAX_COLOUR_LABEL,
  pairColourLabels,
  sanitiseColourLabel,
} from "./colour-labels";

describe("pairing values with their labels", () => {
  it("uses the name the user gave", () => {
    expect(pairColourLabels(["#22C55E"], ["Accent"])).toEqual([
      { value: "#22C55E", label: "Accent", isDefault: false },
    ]);
  });

  it("falls back to a positional name when there is none", () => {
    expect(pairColourLabels(["#22C55E", "#111111"], [])).toEqual([
      { value: "#22C55E", label: "Additional 1", isDefault: true },
      { value: "#111111", label: "Additional 2", isDefault: true },
    ]);
  });

  /* Colour values are free text in this product — a brand may legitimately
     store "Forest green" rather than a hex. */
  it("keeps a colour named in words", () => {
    expect(pairColourLabels(["Forest green"], ["Accent"])[0].value).toBe(
      "Forest green",
    );
  });

  /* The two arrays are stored separately, so every mismatched shape has to
     produce one entry per VALUE rather than throwing or dropping a colour. */
  it.each([
    ["no labels at all", ["#a", "#b"], null, 2],
    ["fewer labels than values", ["#a", "#b", "#c"], ["One"], 3],
    ["more labels than values", ["#a"], ["One", "Two", "Three"], 1],
    ["a sparse labels array", ["#a", "#b"], [undefined, "Two"], 2],
    ["no values", null, ["One"], 0],
  ])("survives %s", (_label, values, labels, expected) => {
    expect(pairColourLabels(values, labels)).toHaveLength(expected);
  });

  it("keeps a later label on its own colour when an earlier one is blank", () => {
    const paired = pairColourLabels(["#a", "#b"], ["", "Neutral"]);
    expect(paired[0].label).toBe("Additional 1");
    expect(paired[1].label).toBe("Neutral");
  });

  /* An empty label is prevented by falling back, which the ticket accepts as
     "a sensible fallback name". */
  it.each(["", "   ", null, undefined])(
    "treats %s as unnamed rather than showing a blank label",
    (label) => {
      const [entry] = pairColourLabels(["#a"], [label]);
      expect(entry.label).toBe("Additional 1");
      expect(entry.isDefault).toBe(true);
    },
  );

  it("drops a blank value rather than showing a nameless swatch", () => {
    expect(
      pairColourLabels(["#a", "  ", "#c"], ["One", "Two", "Three"]),
    ).toEqual([
      { value: "#a", label: "One", isDefault: false },
      { value: "#c", label: "Three", isDefault: false },
    ]);
  });

  it("trims the surrounding space off a label", () => {
    expect(pairColourLabels(["#a"], ["  Accent  "])[0].label).toBe("Accent");
  });

  /* Two colours may legitimately share a role — a brand can have two accents.
     Duplicates are allowed on purpose rather than validated away. */
  it("allows two colours to carry the same name", () => {
    const paired = pairColourLabels(["#a", "#b"], ["Accent", "Accent"]);
    expect(paired.map((p) => p.label)).toEqual(["Accent", "Accent"]);
  });
});

describe("what gets stored", () => {
  it("keeps the array aligned with the values", () => {
    expect(labelsToStore(["One"], 3)).toEqual(["One", "", ""]);
  });

  /* Collapsing the blanks would shift every later label onto the wrong
     swatch the next time the brand is read. */
  it("writes a blank rather than collapsing an unnamed colour", () => {
    expect(labelsToStore(["", "Neutral"], 2)).toEqual(["", "Neutral"]);
  });

  it("drops labels for colours that no longer exist", () => {
    expect(labelsToStore(["One", "Two", "Three"], 1)).toEqual(["One"]);
  });

  /* The positional default is the app's word, not the user's. Storing it
     would make "Additional 2" follow a colour that later moves to slot 1. */
  it("does not store the positional default as if it were chosen", () => {
    expect(labelsToStore(["Additional 1", "Accent"], 2)).toEqual([
      "",
      "Accent",
    ]);
  });

  it("stores nothing for a brand with no additional colours", () => {
    expect(labelsToStore(["One"], 0)).toEqual([]);
  });

  it("round-trips through pairing unchanged", () => {
    const values = ["#a", "#b", "#c"];
    const stored = labelsToStore(["Accent", "", "CTA"], values.length);
    const paired = pairColourLabels(values, stored);
    expect(paired.map((p) => p.label)).toEqual([
      "Accent",
      "Additional 2",
      "CTA",
    ]);
  });
});

describe("a label stays a label", () => {
  it("caps a very long name", () => {
    expect(sanitiseColourLabel("x".repeat(200))).toHaveLength(MAX_COLOUR_LABEL);
  });

  it("trims it", () => {
    expect(sanitiseColourLabel("  Accent  ")).toBe("Accent");
  });

  it("numbers the defaults from one, not zero", () => {
    expect(defaultColourLabel(0)).toBe("Additional 1");
    expect(defaultColourLabel(2)).toBe("Additional 3");
  });
});

/* parseAdditionalColors drops blanks, truncates, de-duplicates and caps, so
   the stored values are frequently not the values the form sent. Pairing by
   position after that slides labels onto the wrong colours. */
describe("aligning labels to the colours that were actually stored", () => {
  it("keeps each label on its own colour when a blank is dropped", () => {
    expect(
      alignLabelsToColours(
        ["#a", "", "#c"],
        ["Accent", "Ignored", "CTA"],
        ["#a", "#c"],
      ),
    ).toEqual(["Accent", "CTA"]);
  });

  /* Two identical values collapse to one, and the first occurrence is the one
     that survives — so its name is the one that should follow it. */
  it("keeps the first name when duplicate colours collapse", () => {
    expect(
      alignLabelsToColours(
        ["#a", "#a", "#b"],
        ["First", "Second", "Third"],
        ["#a", "#b"],
      ),
    ).toEqual(["First", "Third"]);
  });

  it("matches regardless of case", () => {
    expect(alignLabelsToColours(["#AABBCC"], ["Accent"], ["#aabbcc"])).toEqual([
      "Accent",
    ]);
  });

  it("returns a blank for a stored colour nothing named", () => {
    expect(alignLabelsToColours(["#a"], ["Accent"], ["#a", "#b"])).toEqual([
      "Accent",
      "",
    ]);
  });

  it("drops names for colours the sanitiser removed", () => {
    expect(
      alignLabelsToColours(["#a", "#b"], ["Accent", "CTA"], ["#a"]),
    ).toEqual(["Accent"]);
  });

  /* The positional default is the app's word, never stored as if chosen. */
  it("does not store a positional default", () => {
    expect(
      alignLabelsToColours(["#a", "#b"], ["Additional 1", "CTA"], ["#a", "#b"]),
    ).toEqual(["", "CTA"]);
  });

  it("is empty when nothing was stored", () => {
    expect(alignLabelsToColours(["#a"], ["Accent"], [])).toEqual([]);
  });

  it("survives no labels at all", () => {
    expect(alignLabelsToColours(["#a"], null, ["#a"])).toEqual([""]);
  });
});
