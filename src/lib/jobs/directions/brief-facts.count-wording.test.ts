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

describe("a word that describes a one-word counted noun", () => {
  const q = (text: string): BriefFact => ({
    kind: "quantity",
    text,
    needs: needsFor("quantity", text),
  });
  it.each([
    ["30 laptops", "We are buying 30 new laptops for the lab"],
    ["9,800 homes", "14 grids serving 9,800 rural homes"],
    ["80 desks", "80 hot desks"],
    ["120 students", "120 young students"],
    ["9,800 homes", "Every one of these 9,800-home networks"],
    ["9,800 homes", "Every one of these 9,800 homes"],
  ])("%s is stated by %s", (fact, copy) => {
    expect(factStated(q(fact), copy)).toBe(true);
  });
  it.each([
    ["20 spots", "20 parking spots"],
    ["30 laptops", "30 gaming laptops"],
    ["80 desks", "800 desks"],
    ["9,800 homes", "98 homes"],
  ])("%s is not stated by %s", (fact, copy) => {
    expect(factStated(q(fact), copy)).toBe(false);
  });
});

describe("a date that is only a year and its lead", () => {
  const d = (text: string): BriefFact => ({
    kind: "date",
    text,
    needs: needsFor("date", text),
  });
  it.each([
    ["By 2028", "Reach 25,000 homes by 2028", true],
    ["by end of 2027", "14 grids by end of 2027", true],
    ["2028", "Live across Niger State in 2028", true],
    ["By 2028", "Reach 25,000 homes in 2028", false],
    ["by end of 2027", "14 grids by 2027", false],
    ["By 2028", "Reach 2,028 homes", false],
  ])("%s in %s is %s", (fact, copy, stated) => {
    expect(factStated(d(fact), copy)).toBe(stated);
  });
});
