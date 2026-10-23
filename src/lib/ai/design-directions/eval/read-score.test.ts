import { describe, expect, it } from "vitest";
import { DIRECTIONS_EVAL_CASES } from "./cases";
import { READ_EVAL_CASES } from "./read-cases";
import {
  aggregateReads,
  coreWords,
  labelKind,
  readFailures,
  scoreBriefRead,
} from "./read-score";

const FASHION = READ_EVAL_CASES.find(
  (c) => c.id === "fashion-address-then-days",
);

describe("scoreBriefRead", () => {
  it("scores a perfect read at full precision and recall", () => {
    if (!FASHION) throw new Error("fixture");
    const score = scoreBriefRead({
      read: FASHION.facts.filter((f) => !f.optional),
      labels: FASHION.facts,
      brief: FASHION.briefText,
    });
    expect(score.precise).toBe(score.extracted);
    expect(score.recalled).toBe(score.labelled);
  });

  /* The round-4 failure itself must cost precision. */
  it("counts an address that takes part of the days as wrong", () => {
    if (!FASHION) throw new Error("fixture");
    const score = scoreBriefRead({
      read: [{ text: "9 Bourdillon Road, Thursday" }, { text: "₦78,000" }],
      labels: FASHION.facts,
      brief: FASHION.briefText,
    });
    expect(score.precise).toBe(1);
    expect(score.extras).toEqual(["9 Bourdillon Road, Thursday"]);
  });

  it("accepts a fact that joins two labels whole, and ignores the glue", () => {
    const score = scoreBriefRead({
      read: [{ text: "every weekday from 8am" }, { text: "Call 08035550142" }],
      labels: [
        { text: "every weekday" },
        { text: "from 8am" },
        { text: "08035550142" },
      ],
      brief: "Open every weekday from 8am. Call 08035550142.",
    });
    expect(score.precise).toBe(2);
    expect(score.recalled).toBe(3);
  });

  it("accepts a label read in parts, but not a number shared by chance", () => {
    const score = scoreBriefRead({
      read: [
        { text: "Yaba" },
        { text: "Surulere bars" },
        { text: "1 December" },
      ],
      labels: [
        { text: "Yaba and Surulere bars" },
        { text: "Plot 5, Lekki Phase 1" },
        { text: "1 December" },
      ],
      brief: "At Yaba and Surulere bars, Plot 5, Lekki Phase 1, on 1 December.",
    });
    expect(score.extras).toEqual([]);
    expect(score.misses).toEqual(["Plot 5, Lekki Phase 1"]);
  });

  it("counts a price without its quantity as a miss", () => {
    const score = scoreBriefRead({
      read: [{ text: "NGN 34,000" }],
      labels: [{ text: "NGN 34,000 for a set of four" }],
      brief: "Cups at NGN 34,000 for a set of four.",
    });
    expect(score.recalled).toBe(0);
  });

  it("checks the offering and the people", () => {
    const score = scoreBriefRead({
      read: [],
      labels: [],
      brief: "Launch our new cold brew.",
      offering: { kind: "product", phrase: "cold brew" },
      people: [],
      expected: {
        offering: { kind: "product", phrases: ["cold brew"] },
        people: [],
      },
    });
    expect(score.offeringRight).toBe(true);
    expect(score.peopleRight).toBe(true);
    const wrong = scoreBriefRead({
      read: [],
      labels: [],
      brief: "Launch our new cold brew.",
      offering: { kind: "product", phrase: "ice" },
      people: [],
      expected: { offering: { kind: "product", phrases: ["cold brew"] } },
    });
    expect(wrong.offeringRight).toBe(false);
  });

  it("aggregates and fails under the thresholds", () => {
    const totals = aggregateReads([
      {
        extracted: 10,
        precise: 8,
        labelled: 10,
        recalled: 7,
        extras: [],
        misses: [],
        offeringRight: true,
        peopleRight: true,
      },
      null,
    ]);
    expect(totals.unavailable).toBe(1);
    expect(readFailures(totals)).toEqual([
      "read precision 0.80 < 0.95",
      "read recall 0.70 < 0.9",
      "read unavailable 1",
    ]);
  });
});

describe("the labels", () => {
  /* A label that is not the brief's own words can never be matched. */
  it("are every one the brief's own words", () => {
    for (const c of READ_EVAL_CASES) {
      for (const f of c.facts) expect(c.briefText).toContain(f.text);
    }
    for (const c of DIRECTIONS_EVAL_CASES) {
      for (const f of c.facts) expect(c.request.briefText).toContain(f.text);
    }
  });

  it("each have a kind coverage can hold them to", () => {
    expect(labelKind("Call 0907 222 3190")).toBe("contact");
    expect(labelKind("@cake.ng")).toBe("contact");
    expect(labelKind("NGN 34,000 for a set of four")).toBe("price");
    expect(labelKind("9-5")).toBe("time");
    expect(labelKind("ages 13 to 17")).toBe("age");
    expect(labelKind("Saturday 15 November")).toBe("date");
    expect(labelKind("Thursday to Sunday")).toBe("day");
    expect(labelKind("9 Bourdillon Road")).toBe("place");
    expect(labelKind("only 15 made")).toBe("quantity");
    expect(labelKind("no booking needed")).toBe("offer");
  });

  it("read glue as glue and keep a glue-only fact", () => {
    expect([...coreWords("Call or WhatsApp 0812 444 7781")]).toEqual([
      "0812",
      "444",
      "7781",
    ]);
    expect([...coreWords("WhatsApp")]).toEqual(["whatsapp"]);
    expect([...coreWords("₦8,500 small at @cake.ng")]).toEqual([
      "8,500",
      "small",
      "@cake.ng",
    ]);
  });
});
