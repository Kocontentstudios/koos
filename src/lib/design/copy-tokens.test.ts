import { describe, expect, it } from "vitest";
import {
  clausesOf,
  runsOf,
  sentencesOf,
  tokensOf,
  withoutEdgeMarks,
} from "./copy-tokens";

const keys = (text: string) => tokensOf(text).map((t) => t.key);

describe("tokensOf", () => {
  it("reads words, numbers, clock times and amounts as one token each", () => {
    expect(keys("Ages 8+ from 7pm, ₦4,500")).toEqual([
      "w:ages",
      "n:8",
      "+",
      "w:from",
      "c:1140",
      ",",
      "m:ngn|4500",
    ]);
  });

  it.each([["7pm", "7 pm", "19:00", "7:00pm", "7.00 p.m."]])(
    "reads %j and its other spellings as one time",
    (...spellings) => {
      expect(new Set(spellings.map((s) => keys(s).join()))).toEqual(
        new Set(["c:1140"]),
      );
    },
  );

  it.each([
    ["₦4,500", "N4500", "NGN 4,500", "4,500 naira", "₦4.5k"],
    ["R250", "R 250", "ZAR 250", "250 rand"],
    ["₦2.5m", "₦2,500,000"],
    ["GH₵50", "GH¢50", "GHS 50", "50 cedis"],
    ["KSh 300", "KES 300", "Ksh. 300", "300 shillings"],
  ])("reads %j and its other spellings as one amount", (...spellings) => {
    expect(new Set(spellings.map((s) => keys(s).join())).size).toBe(1);
  });

  it("keeps a currency: ₦20 is not $20, and ₦2.5 is not ₦2.5m", () => {
    expect(keys("₦20")).not.toEqual(keys("$20"));
    expect(keys("₦2.5")).not.toEqual(keys("₦2.5m"));
  });

  it("reads a number in words or as an ordinal by its value", () => {
    expect(keys("eight")).toEqual(keys("8"));
    expect(keys("5th")).toEqual(keys("5"));
    expect(tokensOf("5th")[0].ordinal).toBe(true);
  });

  /* Round-10 code critic, S1 to S7: every one of these was invisible
     between "ages" and "8+". */
  it.each(["·", "|", "/", "(", "…", "•", "\n", "🎉", "—", ":", ";"])(
    "makes %j a token that ends a clause",
    (mark) => {
      const tokens = tokensOf(`all ages ${mark} 8+ flavours`);
      expect(clausesOf(tokens).map((c) => c.map((t) => t.key))).toEqual([
        ["w:all", "w:ages"],
        ["n:8", "+", "w:flavours"],
      ]);
    },
  );

  it("joins only by spaces: a line break inside a field is a break", () => {
    expect(runsOf(tokensOf("ages\n8+"), tokensOf("ages 8+"))).toEqual([]);
    expect(runsOf(tokensOf("ages   8+"), tokensOf("ages 8+"))).toEqual([0]);
  });

  it("keeps a range, a ratio and a mark inside their clause", () => {
    for (const text of ["5-12", "5–12", "24/7", "20%", "8+"]) {
      expect(clausesOf(tokensOf(text))).toHaveLength(1);
    }
  });

  it("reads '&' as 'and'", () => {
    expect(keys("Kids & teens")).toEqual(keys("Kids and teens"));
  });
});

describe("runsOf", () => {
  it("finds a run only where every token is the same, marks included", () => {
    expect(
      runsOf(tokensOf("Saturday, 7pm"), tokensOf("Saturday · 7pm")),
    ).toEqual([]);
  });

  it("lets one breaking mark stand for another when asked", () => {
    expect(
      runsOf(tokensOf("this Saturday, 7pm."), tokensOf("Saturday · 7pm"), {
        breaksAlike: true,
      }),
    ).toEqual([1]);
    expect(
      runsOf(tokensOf("ages 8+"), tokensOf("ages · 8+"), { breaksAlike: true }),
    ).toEqual([]);
  });
});

describe("withoutEdgeMarks", () => {
  it("takes the punctuation off an item's edges, never a mark it needs", () => {
    expect(
      withoutEdgeMarks(tokensOf("PRE-ORDER NOW!")).map((t) => t.key),
    ).toEqual(["w:pre", "-", "w:order", "w:now"]);
    expect(withoutEdgeMarks(tokensOf("8+")).map((t) => t.key)).toEqual([
      "n:8",
      "+",
    ]);
    expect(withoutEdgeMarks(tokensOf("@cake.ng"))[0].key).toBe("@");
  });
});

describe("sentencesOf", () => {
  it("counts sentences, not commas", () => {
    expect(sentencesOf("Fresh, warm and ready, daily.")).toHaveLength(1);
    expect(sentencesOf("Fresh daily. Lekki · 7am")).toHaveLength(3);
  });
});
