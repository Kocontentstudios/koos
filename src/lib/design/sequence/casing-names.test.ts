import { describe, expect, it } from "vitest";
import {
  nameRuns,
  sentenceCased,
  upperFirst,
  withConsistentCasing,
} from "./casing";
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

/* O1 round-1 critic, HIGH 7: "Book at freshFold" and "Led by ngozi ade"
   shipped live. */
describe("sentenceCased keeps a name's own capitals", () => {
  it.each([
    ["Join CodeNest camp", ["CodeNest"], "Join CodeNest camp"],
    ["Book At FreshFold Today", ["FreshFold"], "Book at FreshFold today"],
    ["Pay With KudiPay Today", ["KudiPay"], "Pay with KudiPay today"],
    ["Order On WhatsApp", [], "Order on WhatsApp"],
    ["Book Via PayPal Or WhatsApp", [], "Book via PayPal or WhatsApp"],
    ["Shop iFresh Deals", [], "Shop iFresh deals"],
    ["Built On AWS And M-Pesa", ["Lumenfield"], "Built on AWS and M-Pesa"],
    ["Take-Home Starter", [], "Take-home starter"],
  ])("%s -> %s", (text, sources, want) => {
    expect(sentenceCased(text, sources)).toBe(want);
  });

  it("keeps a person's name the brief opens a sentence with a verb before", () => {
    const sources = ["Contact Ngozi Ade, ngozi@lumenfield.ng."];
    expect(sentenceCased("Meet Ngozi Ade", sources)).toBe("Meet Ngozi Ade");
    expect(sentenceCased("Led By Ngozi Ade", sources)).toBe("Led by Ngozi Ade");
  });

  it("does not lower a camel-case brand the set's casing pass recases", () => {
    const frames = withConsistentCasing(
      [
        beatOf({ headline: "Clothes washed and folded", title: "Washed" }),
        beatOf({ headline: "Picked up from your door", title: "Pickup" }),
        beatOf({ headline: "Book A Pickup Today", title: "Book At FreshFold" }),
      ],
      ["FreshFold picks up from your door."],
    ).frames;
    expect(frames[2].title).toBe("Book at FreshFold");
    expect(frames[2].headline).toBe("Book a pickup today");
  });
});

/* "Join ironclad today" shipped as a CTA title beside "Ironclad Gym" in
   the brief, and "IPhone screens are what we do" on a frame. */
describe("casing a name's first word and a camel-case word", () => {
  const GYM = [
    "Ironclad Gym's monthly membership includes free towel service.",
    "Ironclad Gym",
  ];

  it("keeps the first word of a brand name on its own", () => {
    expect(sentenceCased("Join Ironclad today", GYM)).toBe(
      "Join Ironclad today",
    );
    expect(sentenceCased("Train At Ironclad", GYM)).toBe("Train at Ironclad");
  });

  it("still lowers a later word of a name used on its own", () => {
    expect(sentenceCased("Specialty Coffee, cold", ["Kiln Coffee"])).toBe(
      "Specialty coffee, cold",
    );
    expect(
      sentenceCased("Lagos Design festival", [
        "We run Lagos Design Week every December.",
      ]),
    ).toBe("Lagos design festival");
  });

  it("never capitalises a word spelt with a capital after a small letter", () => {
    expect(upperFirst("iPhone screens are what we do")).toBe(
      "iPhone screens are what we do",
    );
    expect(upperFirst("eBay sellers")).toBe("eBay sellers");
    expect(upperFirst("cracked iPhone screen")).toBe("Cracked iPhone screen");
    expect(upperFirst("")).toBe("");
  });
});

describe("sentenceCased: places and the owner's own names", () => {
  it("keeps a country the sources only give as its people's", () => {
    expect(
      sentenceCased("Built For Nigeria", [
        "Invoicing for Nigerian freelancers billing clients abroad.",
      ]),
    ).toBe("Built for Nigeria");
  });

  it("keeps the places an owner's point names", () => {
    expect(
      sentenceCased("20 Rooms In Kaduna And Jos", [
        "Farmlink rents solar cold rooms in Kano.",
        "The raise opens 20 more rooms in Kaduna and Jos",
      ]),
    ).toBe("20 rooms in Kaduna and Jos");
  });

  it("does not take a longer word for a name's stem", () => {
    expect(sentenceCased("Lagos Freelancers Billing", ["Lagos"])).toBe(
      "Lagos freelancers billing",
    );
  });
});
