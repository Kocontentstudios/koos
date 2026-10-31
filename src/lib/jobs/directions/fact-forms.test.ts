import { describe, expect, it } from "vitest";
import { footerLinesFor } from "@/lib/design/render/footer";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
  redundantFooterItems,
} from "./brief-facts";
import { numberFactOf } from "./fact-forms";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});
const field = (headline: string) => ({ headline, footerLines: [] });
const formsOf = (kind: CoverKind, text: string) =>
  numberFactOf(fact(kind, text))?.forms.map((f) => f.text.toLowerCase()) ?? [];

/* The ruling's own examples (Oluwaseyi, 2026-10-28): each fact's accepted
   forms are generated from the parsed fact. */
describe("numberFactOf: the ruling's examples", () => {
  it("gives an age its forms", () => {
    expect(formsOf("age", "18+")).toEqual(
      expect.arrayContaining([
        "18+",
        "18 and over",
        "18 and up",
        "ages 18+",
        "aged 18+",
        "adults 18+",
      ]),
    );
  });

  it.each([
    "Saturday 5 December",
    "Sat 5 Dec",
    "5 December",
    "December 5",
    "5th December",
  ])("states 'Saturday 5 December' with %j", (copy) => {
    expect(factStated(fact("date", "Saturday 5 December"), field(copy))).toBe(
      true,
    );
  });

  it("gives a count its own words", () => {
    expect(formsOf("quantity", "12 stalls")).toContain("12 stalls");
  });

  it("keeps a price's currency, amount and unit together", () => {
    expect(formsOf("price", "₦4,500 a slice")).toEqual(
      expect.arrayContaining([
        "₦4,500 a slice",
        "₦4,500 per slice",
        "₦4,500 / slice",
      ]),
    );
  });

  it("reads an offer, a contact or a day name by its words", () => {
    expect(numberFactOf(fact("offer", "20% off all cakes"))).toBeNull();
    expect(numberFactOf(fact("contact", "WhatsApp 0803 555 0142"))).toBeNull();
    expect(numberFactOf(fact("day", "this Saturday"))).toBeNull();
  });
});

/* The fact writer writes a missing fact in the brief's own words; those
   words must state it. */
describe("every fact states itself", () => {
  it.each([
    ["age", "Ages 8+"],
    ["age", "18+"],
    ["age", "18+ only"],
    ["age", "21 and over"],
    ["age", "ages 5 to 12"],
    ["age", "5-12"],
    ["age", "Kids & teens ages 5-12"],
    ["date", "Saturday 5 December"],
    ["date", "5 December"],
    ["date", "December 5"],
    ["date", "5th December"],
    ["date", "Friday 12 December to Sunday 14 December"],
    ["date", "5-7 December"],
    ["date", "5/12"],
    ["date", "Saturday 5th December 2026"],
    ["date", "Dec 5, 2026"],
    ["date", "30 November"],
    ["quantity", "8 seats"],
    ["quantity", "only 20"],
    ["quantity", "Top 10 finalists"],
    ["quantity", "two senior React engineers"],
    ["quantity", "20"],
    ["price", "₦4,500 a slice"],
    ["price", "₦3,000"],
    ["price", "Three 150ml tasters for ₦6,000"],
    ["price", "₦2,000 each"],
    ["price", "$20 per class"],
    ["time", "9-5"],
    ["time", "9-5 weekdays"],
    ["time", "from 7am"],
    ["time", "9am–5pm"],
    ["time", "12–6pm"],
    ["time", "9-5pm"],
    ["place", "9 Bourdillon Road, Ikoyi"],
    ["place", "Plot 5, Admiralty Way"],
    ["place", "Lekki Phase 1"],
    ["day", "every 2nd Saturday"],
  ] as const)("%s %j", (kind, text) => {
    expect(factStated(fact(kind, text), field(text))).toBe(true);
  });
});

/* The round-11 builder's own attacks on the forms, before review: the
   neighbouring inputs of each critic probe. */
describe("forms against neighbouring inputs", () => {
  it.each([
    ["date", "5 December", "Top 5 December deals", false],
    ["date", "5 December", "Our 5 December picks", false],
    ["date", "5 December", "5 December · 7pm", true],
    ["date", "5 December", "5 December, Lekki", true],
    ["date", "5 December", "5 December at Yaba", true],
    ["date", "Saturday 5 December", "Friday 5 December", false],
    ["date", "Saturday 5 December", "Friday, 5 December", false],
    ["date", "Saturday 5 December", "Sat. 5 Dec.", true],
    ["date", "Saturday 5 December", "SATURDAY 5 DECEMBER", true],
    ["date", "Saturday 5 December", "Saturday 5 · December", false],
    ["date", "Saturday 5 December", "Saturday 5/December", false],
    ["date", "Saturday 5 December", "Saturday (5 December)", true],
    ["date", "5 December", "Doors 5 December 2026", true],
    ["date", "5 December", "12/5 December", false],
    ["date", "5 December", "15 December", false],
    ["date", "5 December", "5 Decembers", false],
    ["date", "December 5", "December 5-7", false],
    ["date", "December 5", "December 5th stalls", true],
    ["date", "5-7 December", "5-7 December", true],
    ["date", "5-7 December", "5 to 7 Dec", true],
    ["date", "5-7 December", "5 December", false],
    ["date", "5-7 December", "December 5-7", true],
    ["date", "5/12", "5/12/2026", true],
    ["date", "5/12", "Kids 5/12", true],
    ["age", "Ages 8+", "Ages 8+ welcome", true],
    ["age", "Ages 8+", "Ages 18+", false],
    ["age", "Ages 8+", "Ages 8", false],
    ["age", "Ages 8+", "Ages 8 -", false],
    ["age", "18+", "18+ cocktails", false],
    ["age", "18+", "Choose from 18+", false],
    ["age", "18+", "Choose from 18+.", false],
    ["age", "18+", "Over 18+", false],
    ["age", "18+", "18+ · cocktails", true],
    ["age", "18+", "Cocktails: 18+", false],
    ["age", "18+", "Age: 18+", true],
    ["age", "18+", "Strictly 18+!", true],
    ["age", "18+", "Only 18+ flavours", false],
    ["age", "21 and over", "21 and over flavours", false],
    ["age", "21 and over", "21 and up", true],
    ["age", "5-12", "Kids 5-12", true],
    ["age", "5-12", "5-12", true],
    ["age", "5-12", "Sizes 5-12", false],
    ["quantity", "8 seats", "8 seats", true],
    ["quantity", "8 seats", "18 seats", false],
    ["quantity", "8 seats", "8 · seats", false],
    ["quantity", "8 seats", "8, seats", false],
    ["quantity", "8 seats", "Seats: 8 days", false],
    ["quantity", "8 seats", "Seats: 8", true],
    ["quantity", "8 seats", "Seats/8", false],
    ["quantity", "8 seats", "Eight seats", true],
    ["quantity", "20", "20 minutes away", false],
    ["quantity", "20", "Only 20", false],
    ["quantity", "20", "20", true],
    ["quantity", "only 20", "only 20", true],
    ["price", "₦4,500 a slice", "Save ₦4,500 a slice", false],
    ["price", "₦4,500 a slice", "₦4,500 off a slice", false],
    ["price", "₦4,500 a slice", "₦4,500 · a slice", false],
    ["price", "₦4,500 a slice", "₦4,500. A slice of heaven", false],
    ["price", "₦4,500 a slice", "₦4,500/slice", true],
    ["price", "₦4,500 a slice", "₦4,500 per slice of cake", true],
    ["price", "₦4,500 a slice", "₦4,500 a box", false],
    ["price", "₦4,500 a slice", "$4,500 a slice", false],
    ["price", "₦4,500 a slice", "₦45,000 a slice", false],
    ["price", "₦3,000", "₦3,000", true],
    ["price", "₦3,000", "Save ₦3,000", false],
    ["time", "9-5", "Ages 9-5", false],
    ["time", "9-5", "Sizes 9-5", false],
    ["time", "9-5", "Open 9-5", true],
    ["time", "9-5", "Mon-Fri 9-5", true],
    ["time", "9-5", "9-5 December", false],
    ["time", "9-5", "12 9-5", false],
    ["time", "9am–5pm", "9am to 5pm", true],
    ["time", "9am–5pm", "9am · 5pm", false],
    ["time", "9am–5pm", "09:00–17:00", true],
    ["time", "9am–5pm", "9am–6pm", false],
    ["time", "9am–5pm", "9–5pm", true],
    ["time", "from 7pm", "Doors 7pm", false],
    ["time", "from 7pm", "Doors from 7pm", true],
    ["time", "from 7pm", "Doors 7am", false],
    ["place", "9 Bourdillon Road, Ikoyi", "9 Bourdillon Rd, Ikoyi", true],
    ["place", "9 Bourdillon Road, Ikoyi", "19 Bourdillon Road, Ikoyi", false],
    ["place", "9 Bourdillon Road, Ikoyi", "9 · Bourdillon Road, Ikoyi", false],
    ["place", "9 Bourdillon Road, Ikoyi", "Bourdillon Road 9, Ikoyi", false],
  ] as const)("%s %j in %j: %s", (kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), field(copy))).toBe(stated);
  });
});

describe("the repeat checks read clauses as the verifier does", () => {
  it.each([
    ["Ages 8+", "Fun for all ages\n8+ flavours", true],
    ["Ages 8+", "Fun for all ages (8+ flavours)", true],
    ["Ages 8+", "Fun for all ages… 8+ flavours", true],
    ["Ages 8+", "Ages 8+ welcome", true],
    ["5 December", "Saturday 5 December", true],
    ["5 December", "Shop with us. 5 December", false],
  ])("footer %j under %j kept: %s", (line, subheadline, kept) => {
    expect(
      footerLinesFor({ footerStyle: "text", subheadline, footerLines: [line] })
        .length > 0,
    ).toBe(kept);
  });

  it.each([
    ["Fun for all ages | 8+ flavours", ["Ages 8+"], []],
    ["Fun for all ages\n8+ flavours", ["Ages 8+"], []],
    ["Saturday 5 stalls, 12 December", ["Saturday 5 December"], []],
    ["Saturday 5 December", ["5 December"], ["5 December"]],
  ])("under %j, %j drops %j", (headline, footerLines, dropped) => {
    expect(
      redundantFooterItems({ headline, subheadline: "", cta: "", footerLines }),
    ).toEqual(dropped);
  });
});

/* Eval run a at 5d49a60, replayed through both verifiers
   (critique-11/verdict-diffs.txt): delivered copy the forms first read
   wrong. A date with no weekday was refused beside any weekday, and an
   amountless price was read by its words anywhere. */
describe("delivered copy from eval run a", () => {
  it.each([
    ["date", "1 November", "Pre-orders open Friday 1 November. ₦38,000.", true],
    ["date", "9 November", "Join us on Sunday 9 November, 2pm to 5pm.", true],
    ["date", "9 November", "Come pour on Sunday, 9 November from 2pm.", true],
    ["price", "first class is free", "Your first HIIT class is free.", false],
    ["price", "first session is free", "First session is free", true],
    [
      "quantity",
      "Two 90-minute sessions a week",
      "Maths and physics tutoring at home, with two 90-minute sessions a week.",
      true,
    ],
    ["age", "18+", "Adults 18+ · Just 10 seats", true],
    /* Recorded fail-closed: an amount and its unit in different sentences,
       and a list joined by a comma for the brief's "and". */
    [
      "price",
      "three shots for ₦6,000",
      "Three shots. One origin. ₦6,000.",
      false,
    ],
    [
      "quantity",
      "six pastries and a handwritten card",
      "Six pastries, a handwritten card, ₦25,000.",
      false,
    ],
  ] as const)("%s %j in %j: %s", (kind, text, copy, stated) => {
    expect(factStated(fact(kind, text), field(copy))).toBe(stated);
  });
});
