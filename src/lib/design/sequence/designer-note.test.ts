import { describe, expect, it } from "vitest";
import { needsFor } from "@/lib/jobs/directions/brief-facts";
import {
  audienceNotes,
  designerNoteKind,
  designerNotes,
  onlyForDesigner,
  opensOnDesignerNote,
  readerBrief,
  withoutNoteLabel,
} from "./designer-note";
import { LUMEN_BRIEF } from "./fixtures";

const LUMEN = LUMEN_BRIEF;

const DECK =
  "A short deck for office managers in Lagos: Lumen Coffee now supplies offices with fresh-roasted beans and a weekly barista visit. Plans start at N85,000 a month for up to 20 staff. Contact wholesale@lumencoffee.ng.";

describe("designerNoteKind", () => {
  it.each([
    ["Audience: young professionals in Yaba", "audience"],
    ["Target audience: SS3 students", "audience"],
    ["Target: busy mums", "audience"],
    ["For: first-time buyers", "audience"],
    ["Target market: offices in Ikeja", "audience"],
    ["Tone: warm and playful", "instruction"],
    ["Goal: more pre-orders", "instruction"],
    ["Brand colours: green and gold", "instruction"],
  ])("reads %s as a %s note", (text, kind) => {
    expect(designerNoteKind(text)).toBe(kind);
  });

  it.each([
    "Launch day only: buy two, get a free pastry",
    "Open 12:30 to 9pm daily",
    "Visit https://lumencoffee.ng today",
    "Steeped for 20 hours",
    "Before: no sauce. After: Oyo fire.",
  ])("leaves %s, a line for the reader", (text) => {
    expect(opensOnDesignerNote(text)).toBe(false);
  });
});

describe("the brief as the reader may be told it", () => {
  it("takes the audience note out of the reader's brief and keeps it as a note", () => {
    expect(readerBrief(LUMEN)).not.toMatch(/Audience|young professionals/);
    expect(readerBrief(LUMEN)).toContain("Launch day only: buy two");
    expect(designerNotes(LUMEN)).toEqual([
      "Audience: young professionals in Yaba and Surulere who want a smooth, low-acid coffee.",
    ]);
    expect(audienceNotes(LUMEN)).toEqual([
      "Young professionals in Yaba and Surulere who want a smooth, low-acid coffee.",
    ]);
  });

  it("takes the label off and nothing else", () => {
    expect(withoutNoteLabel("Audience: young professionals")).toBe(
      "Young professionals",
    );
    expect(withoutNoteLabel("Launch day only: buy two")).toBe(
      "Launch day only: buy two",
    );
  });

  it("knows a fact only the words to the designer give", () => {
    const fact = (kind: "place", text: string) => ({
      kind,
      text,
      needs: needsFor(kind, text),
    });
    expect(onlyForDesigner(fact("place", "Lagos"), DECK)).toBe(true);
    expect(onlyForDesigner(fact("place", "Surulere"), LUMEN)).toBe(true);
    expect(onlyForDesigner(fact("place", "our Yaba shop"), LUMEN)).toBe(false);
  });
});
