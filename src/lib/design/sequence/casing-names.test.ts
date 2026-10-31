import { describe, expect, it } from "vitest";
import { nameRuns, withConsistentCasing } from "./casing";
import { beatOf } from "./fixtures";
import { isCutTitle } from "./title";

/* Arc round-4 critic, MEDIUM 6: names cased wrong or cut mid-name. */
describe("withConsistentCasing keeps a multi-word name whole", () => {
  const recase = (headlines: string[], titles: string[], sources: string[]) =>
    withConsistentCasing(
      headlines.map((headline, i) => beatOf({ headline, title: titles[i] })),
      sources,
    ).frames;

  it("writes 'Bright Path' with both capitals, however the copy cased it", () => {
    const frames = recase(
      [
        "Six weeks of past papers",
        "Every script marked by Friday",
        "Register Your Seat At Bright Path Today",
      ],
      ["Six weeks", "Marked by Friday", "Register at bright Path"],
      [
        "Bright Path",
        "Maths crash course for SS3 students. Register at brightpath.ng.",
      ],
    );
    expect(frames[2].headline).toBe("Register your seat at Bright Path today");
    expect(frames[2].title).toBe("Register at Bright Path");
  });

  it("lowers a word that is capitalised only inside the brand's name", () => {
    const frames = recase(
      [
        "Beans from one farm",
        "Roasted here each week",
        "Nigerian-Grown Specialty Coffee",
      ],
      ["One farm", "Each week", "Nigerian-grown specialty Coffee"],
      [
        "Kiln Coffee",
        "Specialty coffee and cold brew from Nigerian-grown beans",
      ],
    );
    expect(frames[2].headline).toBe("Nigerian-grown specialty coffee");
    expect(frames[2].title).toBe("Nigerian-grown specialty coffee");
  });

  it("keeps 'Kiln Coffee' itself whole", () => {
    const frames = recase(
      [
        "Beans from one farm",
        "Roasted here each week",
        "Pour One Glass At Kiln Coffee",
      ],
      ["One farm", "Each week", "At Kiln Coffee"],
      ["Kiln Coffee"],
    );
    expect(frames[2].headline).toBe("Pour one glass at Kiln Coffee");
  });

  it("reads runs from a source, the small word that opens a sentence aside", () => {
    expect(nameRuns(["The Lagos Design Week opens Monday."]).runs).toEqual([
      ["lagos", "design", "week"],
    ]);
  });
});

describe("isCutTitle on a name cut short", () => {
  const sources = [
    "We are in Independence Layout, Enugu.",
    "Clinic in Ikeja GRA",
  ];
  it("finds a title that ends inside a name", () => {
    expect(
      isCutTitle("Coworking space in Independence", [
        "Coworking space in Independence Layout",
      ]),
    ).toBe(true);
    expect(isCutTitle("We are in Independence", sources)).toBe(true);
  });
  it("keeps a name with its area code as whole", () => {
    expect(isCutTitle("Clinic in Ikeja", sources)).toBe(false);
  });
});
