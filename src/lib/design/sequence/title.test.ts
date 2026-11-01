import { describe, expect, it } from "vitest";
import { beatOf } from "./fixtures";
import {
  cleanTitle,
  isCleanTitle,
  isCutTitle,
  sameTitle,
  settledTitle,
  titleFault,
  titleLeaks,
  titleOffCopy,
  titleProblems,
  withSettledTitles,
} from "./title";

describe("cleanTitle", () => {
  it.each([
    ["Roasted in-house — version A", "Roasted in-house"],
    ["Reserve your bottle — Version B", "Reserve your bottle"],
    ["Shirts and repairs too — version B (P1)", "Shirts and repairs too"],
    ["The price (version 2)", "The price"],
    ["Where to find us: Option A", "Where to find us"],
    ["Made by hand (B2)", "Made by hand"],
    ["Who it is for v2", "Who it is for"],
  ])("takes the planner's label off %j", (title, clean) => {
    expect(cleanTitle(title)).toBe(clean);
  });

  it.each([
    "Take a seat",
    "Options for every budget",
    "Draft beer on tap",
    "V-neck tees",
    "Version history explained",
    "The B2B plan",
  ])("leaves a real name alone: %j", (title) => {
    expect(cleanTitle(title)).toBe(title);
    expect(titleLeaks(title)).toEqual([]);
  });
});

describe("isCleanTitle", () => {
  it("refuses a label, an empty title and one past the card's room", () => {
    expect(isCleanTitle("The price — version A")).toBe(false);
    expect(isCleanTitle("Generous portions (P3)")).toBe(false);
    expect(isCleanTitle("  ")).toBe(false);
    expect(
      isCleanTitle("A very long title that runs well past what a card shows"),
    ).toBe(false);
    expect(isCleanTitle("Where to find us")).toBe(true);
  });
});

describe("titleFault: the frame's job and a lone word", () => {
  it.each([
    "Hook: Our head chef",
    "Family plan hook",
    "Free delivery hook",
    "The hook",
    "CTA slide",
    "Call to action",
    "Title slide",
    "Frame 3",
    "Slide 2 overview",
  ])("refuses the planner's role word in %j", (title) => {
    expect(isCleanTitle(title)).toBe(false);
  });

  it.each(["Repairs", "Pricing"])("refuses the one-word title %j", (title) => {
    expect(titleFault(title)).toBe("it is one word, not a name");
  });

  it.each([
    "Hand-dyed in Abeokuta",
    "Slides and sandals",
    "Frames for every face",
    "Hooked on cold brew",
    "Hems and alterations",
  ])("leaves a real name alone: %j", (title) => {
    expect(titleFault(title)).toBeNull();
  });
});

describe("settledTitle", () => {
  it("keeps the proposed title cleaned, else the one the frame had", () => {
    expect(settledTitle("Roasted weekly — version B", "Roasting")).toBe(
      "Roasted weekly",
    );
    expect(settledTitle("version A", "Roasting")).toBe("Roasting");
    expect(settledTitle("", "Generous portions — Version A")).toBe(
      "Generous portions",
    );
  });
});

describe("titleFault", () => {
  it.each([
    ["How to act", /placeholder/],
    ["Point 3", /placeholder/],
    ["$1 2m pre-series", /lost its comma/],
    ["₦18 000 a month", /lost its comma/],
    ["For apartment dwellers who", /mid-phrase/],
    ["Beans from one", null],
    ["Beans from the", /mid-phrase/],
    ["Services B", /planner label/],
  ])("reads %j", (title, fault) => {
    const found = titleFault(title);
    if (fault === null) expect(found).toBeNull();
    else expect(found).toMatch(fault);
  });

  it("passes a whole name with its figure intact", () => {
    expect(titleFault("₦18,000 a month")).toBeNull();
    expect(titleFault("$1.2m pre-series A")).toBeNull();
    expect(titleFault("Our Series A")).toBeNull();
  });
});

describe("isCutTitle", () => {
  const sources = [
    "Taught by volunteer engineers from the community",
    "Solar kits for small shops, paid weekly by mobile money",
    "Free repotting for life",
    "Book on WhatsApp 0816 404 5050",
    "Clinic in Ikeja GRA",
    "Make the Yaba bar a weekend habit",
  ];

  it.each([
    "Taught by volunteer",
    "Solar kits for small",
    "Paid weekly by mobile",
  ])("finds %j cut from a longer phrase", (title) => {
    expect(isCutTitle(title, sources)).toBe(true);
  });

  it.each([
    "Free repotting",
    "Solar kits",
    "Paid weekly",
    "Book on WhatsApp",
    "Clinic in Ikeja",
    "The Yaba bar",
    "Something else entirely",
  ])("takes %j as whole", (title) => {
    expect(isCutTitle(title, sources)).toBe(false);
  });
});

describe("titleOffCopy", () => {
  it("finds a title sharing no word with its own frame's copy", () => {
    expect(
      titleOffCopy(
        beatOf({
          title: "Ikoyi roots",
          headline: "A morning of hands-on baking",
        }),
      ),
    ).toBe(true);
    expect(
      titleOffCopy(beatOf({ title: "The price", headline: "Book your place" })),
    ).toBe(true);
  });

  it("passes a title built on its own copy", () => {
    expect(
      titleOffCopy(
        beatOf({ title: "Our bakery", headline: "Our bakery is in Ikoyi" }),
      ),
    ).toBe(false);
  });
});

describe("titleFault: a figure cut at its comma", () => {
  it.each(["1", "₦7,500", "82%", "3 · 4"])("refuses %j as a name", (title) => {
    expect(titleFault(title)).toBe("it is a bare figure, not a name");
  });

  it("takes a title with a figure and a word", () => {
    expect(titleFault("1,900 sellers")).toBeNull();
  });

  it("settles a deck's action slide titled by a cut figure on its own copy", () => {
    const frames = [
      beatOf({
        role: "hook",
        title: "Cold rooms",
        headline: "Cold rooms by the crate",
      }),
      beatOf({
        role: "cta",
        title: "1",
        headline: "1,900 sellers are waiting for the next room",
        cta: "Email Ada",
      }),
    ];
    const settled = withSettledTitles(frames, { sources: [] });
    expect(titleProblems(settled, { sources: [] })).toEqual([]);
    expect(settled[1].title).not.toBe("1");
  });
});

describe("titleProblems and withSettledTitles", () => {
  const rules = { sources: ["Solar kits for small shops in the north"] };
  const frames = [
    beatOf({
      role: "hook",
      title: "Solar kits for small",
      headline: "Solar kits that pay back",
    }),
    beatOf({ title: "How to act", headline: "Shops repay weekly by phone" }),
    beatOf({ title: "the kits", headline: "Installed in two hours" }),
    beatOf({
      role: "cta",
      title: "The kits",
      headline: "Join the round",
      cta: "Email us",
    }),
  ];

  it("names every title that is cut, a placeholder, a repeat or another frame's", () => {
    expect(titleProblems(frames, rules).map((p) => p.frame)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  it("settles each title on a whole, distinct name from the frame's own copy", () => {
    const settled = withSettledTitles(frames, rules);
    expect(titleProblems(settled, rules)).toEqual([]);
    expect(settled.map((f) => f.title)).toEqual([
      "Solar kits that pay back",
      "Shops repay weekly by phone",
      "Installed in two hours",
      "Join the round",
    ]);
    for (let i = 1; i < settled.length; i += 1) {
      expect(sameTitle(settled[i].title, settled[i - 1].title)).toBe(false);
    }
  });

  it("keeps a title that already fits", () => {
    const fine = [
      beatOf({
        role: "hook",
        title: "Solar kits",
        headline: "Solar kits that pay for themselves",
      }),
      beatOf({
        role: "cta",
        title: "Join us",
        headline: "Join the round",
        cta: "Email us",
      }),
    ];
    expect(withSettledTitles(fine, rules).map((f) => f.title)).toEqual([
      "Solar kits",
      "Join us",
    ]);
  });
});

describe("withSettledTitles: when every longer name is cut or too long", () => {
  it("settles on a short head of the headline rather than keep a title off its copy", () => {
    const sources = [
      "Private offices and meeting rooms come included every month for teams",
    ];
    const frames = [
      beatOf({
        role: "hook",
        title: "Team plan",
        headline: "A team plan for small teams",
      }),
      beatOf({
        title: "Always connected",
        headline: "Private offices and meeting rooms come included",
      }),
      beatOf({
        role: "cta",
        title: "Book a tour",
        headline: "Book a tour this week",
        cta: "Book a tour",
      }),
    ];
    const settled = withSettledTitles(frames, { sources }, [
      [],
      ["Private offices and meeting rooms"],
      [],
    ]);
    expect(settled[1].title).toBe("Private offices");
    expect(titleProblems(settled, { sources })).toEqual([]);
  });
});

/* "Every rider deserves", cut from "Every rider deserves to stay
   rolling", is not a card title. */
describe("titleFault on a title that ends on a verb wanting more", () => {
  it.each(["Every rider deserves", "Your bike needs", "We help", "Keep"])(
    "faults %s",
    (title) => {
      expect(titleFault(title)).not.toBeNull();
    },
  );
  it.each([
    "Bikes that keep rolling",
    "Riders deserve better",
    "Free pickup offer",
  ])("passes %s", (title) => {
    expect(titleFault(title)).toBeNull();
  });
});
