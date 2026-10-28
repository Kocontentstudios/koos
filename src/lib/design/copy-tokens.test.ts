import { describe, expect, it } from "vitest";
import {
  clausesOf,
  joinedInWords,
  numberWordsOf,
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

  /* Round-11 code critic, J13 and F1 to F6: the renderer let any break
     stand for any other, so "Ages: 8+" was hidden as a repeat of "all ages
     · 8+ flavours" while the verifier, whose forms name their own marks,
     counted it as the age. One rule now, and no mark stands for another. */
  it.each([
    ["Ages: 8+", "Fun for all ages · 8+ flavours"],
    ["Seats: 8", "Book your seats · 8 courses"],
    ["Saturday, 5 December", "This Saturday · 5 December stalls"],
    ["Top picks, 5 December", "Top picks — 5 December deals"],
  ])("never reads %j inside %j", (line, above) => {
    expect(runsOf(tokensOf(above), tokensOf(line))).toEqual([]);
  });
});

describe("tokensOf, what joins and what does not", () => {
  /* Round-11 code critic, U8, U13 and U14: \v, \f and U+FEFF joined
     tokens as if they were spaces. */
  it.each(["\v", "\f", "\ufeff", "\u1680"])(
    "reads %j as a break, not a space",
    (char) => {
      expect(clausesOf(tokensOf(`all ages${char}8+ flavours`))).toHaveLength(2);
    },
  );

  it.each([" ", "\t", "\u00a0", "\u2009", "\u202f", "\u3000"])(
    "reads %j as a space",
    (char) => {
      expect(keys(`ages${char}8+`)).toEqual(keys("ages 8+"));
    },
  );

  /* Round-11 code critic, W5 to W10: a multiplier made a second token, so
     "five hundred seats" held the run "hundred seats", 100 seats. */
  it.each([
    ["five hundred seats", "500 seats"],
    ["five thousand guests", "5000 guests"],
    ["two dozen cupcakes", "24 cupcakes"],
    ["a dozen cupcakes", "a 12 cupcakes"],
    ["2 million users", "2000000 users"],
    ["3 hundred seats", "300 seats"],
    ["twenty-five guests", "25 guests"],
    ["twenty five guests", "25 guests"],
    ["five hundred and fifty seats", "550 seats"],
    ["two thousand five hundred guests", "2500 guests"],
  ])("reads %j as one number, %j", (words, digits) => {
    expect(keys(words)).toEqual(keys(digits));
  });

  it("never folds two numbers that are not one value", () => {
    expect(keys("Two 90-minute sessions")).toEqual(
      keys("2 90-minute sessions"),
    );
    expect(keys("five six")).toEqual(["n:5", "n:6"]);
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

/* Round-12 code critic: the verifier refused "One seat left" for "1 seat"
   while claims.inventedFacts counted "one"; both now read number words
   through numberWordsOf. */
describe("number words, read once for the verifier and inventedFacts", () => {
  it("reads 'one' where it counts, and as the units of a tens word", () => {
    expect(keys("One seat left")[0]).toBe("n:1");
    expect(keys("Twenty-one guests")[0]).toBe("n:21");
    expect(keys("twenty one seats")[0]).toBe("n:21");
    expect(keys("one hundred seats")[0]).toBe("n:100");
    expect(keys("the one seat")).toContain("w:one");
    expect(keys("one of us")[0]).toBe("w:one");
  });

  it("gives every number word with where it stands", () => {
    const text = "Five hundred seats, one stage";
    expect(numberWordsOf(text)).toEqual([
      { value: 500, text: "Five hundred", start: 0, end: 12 },
      { value: 1, text: "one", start: 20, end: 23 },
    ]);
  });
});

/* Round-14 code critic, finding 6: "Gifts under one roof" read "one" as a
   count of roofs, and J14's design was lost to inventedFacts. */
describe("'one' in a set phrase counts nothing", () => {
  it.each([
    "Gifts under one roof",
    "Everything in one place",
    "All-in-one gift box",
    "all in one gift box",
    "Your one-stop gift shop",
    "One of a kind gifts",
    "One day only",
  ])("%j holds no number", (text) => {
    expect(numberWordsOf(text)).toEqual([]);
  });

  it("still counts where 'one' counts", () => {
    expect(keys("One seat left")[0]).toBe("n:1");
    expect(keys("One night only")[0]).toBe("n:1");
    expect(keys("one roof garden, one stage")).toContain("n:1");
  });
});

/* Round-14 code critic, break 2: "to", "till", "until", "through" and
   "and" join two numbers as "-" does; "in" joins two plain numbers into a
   ratio. */
describe("joinedInWords", () => {
  const sideOf = (text: string) => tokensOf(text);
  it.each([
    ["to 5pm", true],
    ["till 7pm", true],
    ["until 9pm", true],
    ["through 9pm", true],
    ["and 10 seats", true],
    ["to the market", false],
    ["and Sunday", false],
  ])("a number then %j: %s", (text, joined) => {
    expect(joinedInWords(tokensOf("9")[0], sideOf(text))).toBe(joined);
  });

  it("reads 'in' between plain numbers only", () => {
    expect(joinedInWords(tokensOf("1")[0], sideOf("in 10"))).toBe(true);
    expect(joinedInWords(tokensOf("7pm")[0], sideOf("in 2 venues"))).toBe(
      false,
    );
    expect(joinedInWords(tokensOf("1")[0], sideOf("of 10"))).toBe(false);
  });
});
