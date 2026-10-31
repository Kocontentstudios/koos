import { describe, expect, it } from "vitest";
import { type BriefFact, factStated, needsFor } from "./brief-facts";

const fact = (kind: BriefFact["kind"], text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

describe("factStated: a count in the copy's own wording", () => {
  it.each([
    ["14 cold rooms", "Farmlink runs 14 solar cold rooms in Kano"],
    ["14 cold rooms", "14 new cold rooms across Kano"],
    ["9,800 homes", "Power for 9,800-home networks across Niger State"],
    ["80 desks", "80 desks across two floors"],
  ])("counts %s as stated in %s", (text, copy) => {
    expect(factStated(fact("quantity", text), copy)).toBe(true);
  });

  it.each([
    ["14 cold rooms", "4 cold rooms in 14 towns"],
    ["14 cold rooms", "14 towns with cold rooms"],
    ["14 cold rooms", "14 farmers rent cold rooms"],
    ["14 cold rooms", "14 farms cold rooms"],
    ["14 cold rooms", "140 solar cold rooms"],
    ["80 desks", "8 desks and 80 chairs"],
    ["12 stylists", "Our 2 stylists run 12 chairs"],
    ["9,800 homes", "Power for 9,800-watt homes"],
  ])("does not count %s as stated in %s", (text, copy) => {
    expect(factStated(fact("quantity", text), copy)).toBe(false);
  });
});

describe("factStated: a word before a bare noun is another thing counted", () => {
  it("keeps 20 parking spots apart from 20 spots", () => {
    expect(factStated(fact("quantity", "20 spots"), "20 parking spots")).toBe(
      false,
    );
  });
});
