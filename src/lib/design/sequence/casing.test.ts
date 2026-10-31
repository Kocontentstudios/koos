import { describe, expect, it } from "vitest";
import { headlineCase, properNouns, withConsistentCasing } from "./casing";
import { beatOf } from "./fixtures";

const SOURCES = [
  "Exam prep for WAEC candidates in Yaba. Classes run six Saturdays with Mr Bello.",
];

const frames = (...headlines: string[]) =>
  headlines.map((headline) => beatOf({ headline }));

describe("headlineCase", () => {
  it("reads title case and sentence case, leaving names and acronyms out", () => {
    const names = properNouns(SOURCES);
    expect(
      headlineCase("Taught by Teachers Who Mark WAEC Scripts", names),
    ).toBe("title");
    expect(
      headlineCase("Six Saturdays with Mr Bello in Yaba", names),
    ).toBeNull();
    expect(headlineCase("Practice papers marked every week", names)).toBe(
      "sentence",
    );
  });

  it("cannot tell a headline of one or two words", () => {
    expect(headlineCase("Book now")).toBeNull();
  });
});

describe("withConsistentCasing", () => {
  it("sets the odd headline in the casing most of the set uses, keeping names", () => {
    const result = withConsistentCasing(
      frames(
        "Practice papers marked every week",
        "Taught by Teachers Who Mark WAEC Scripts",
        "Small classes with time for questions",
        "Six Saturdays with Mr Bello in Yaba",
      ),
      SOURCES,
    );
    expect(result.style).toBe("sentence");
    expect(result.recased).toEqual([1]);
    expect(result.frames[1].headline).toBe(
      "Taught by teachers who mark WAEC scripts",
    );
    expect(result.frames[3].headline).toBe(
      "Six Saturdays with Mr Bello in Yaba",
    );
  });

  it("sets a lone sentence-case headline in title case when the set uses it", () => {
    const result = withConsistentCasing(
      frames(
        "Practice Papers Marked Every Week",
        "Small Classes With Time For Questions",
        "Taught by teachers who mark the scripts",
      ),
      SOURCES,
    );
    expect(result.style).toBe("title");
    expect(result.frames[2].headline).toBe(
      "Taught by Teachers Who Mark the Scripts",
    );
  });

  it("leaves a set already in one casing as it is", () => {
    const set = frames(
      "Practice papers marked every week",
      "Small classes with time for questions",
    );
    const result = withConsistentCasing(set, SOURCES);
    expect(result.recased).toEqual([]);
    expect(result.frames).toEqual(set);
  });

  it("starts each sentence of a recased headline with a capital", () => {
    const result = withConsistentCasing(
      frames(
        "Practice papers marked every week",
        "Small classes with time for questions",
        "No Rush. Real Marking Every Week",
      ),
      SOURCES,
    );
    expect(result.frames[2].headline).toBe("No rush. Real marking every week");
  });
});

describe("withConsistentCasing: card titles", () => {
  it("sets every title in the set's casing, keeping names", () => {
    const set = [
      beatOf({
        headline: "Practice papers marked every week",
        title: "Weekly Papers",
      }),
      beatOf({
        headline: "Small classes with time for questions",
        title: "Small classes",
      }),
      beatOf({
        headline: "Taught on Saturdays in Yaba",
        title: "Saturdays In Yaba",
      }),
    ];
    const { frames: cased } = withConsistentCasing(set, SOURCES);
    expect(cased.map((f) => f.title)).toEqual([
      "Weekly papers",
      "Small classes",
      "Saturdays in Yaba",
    ]);
  });
});

describe("withConsistentCasing: hyphenated words", () => {
  it("lowers the part after a hyphen in a sentence-case set, first word too", () => {
    const set = [
      beatOf({
        headline: "Fresh loaves every morning",
        title: "Take-Home goods",
      }),
      beatOf({
        headline: "Made by our own bakers",
        title: "On-Time every visit",
      }),
      beatOf({ headline: "Beans from the Plateau", title: "Hand-dyed cloth" }),
    ];
    const { frames: cased } = withConsistentCasing(set, SOURCES);
    expect(cased.map((f) => f.title)).toEqual([
      "Take-home goods",
      "On-time every visit",
      "Hand-dyed cloth",
    ]);
  });
});
