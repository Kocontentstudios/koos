import { describe, expect, it } from "vitest";
import { sentenceSpansOf } from "@/lib/design/copy-tokens";
import {
  type BriefFact,
  type CoverKind,
  contradictedDates,
  factStated,
  needsFor,
  withoutContradictedDates,
} from "./brief-facts";
import { factLedger } from "./claims";
import { rewriteFault } from "./fact-writer";

/*
 * Round 20, the last verifier round for PR 1 (Oluwaseyi's ruling,
 * 2026-10-28), against the round-19 code critic's probes
 * (/tmp/feat-033/critique/u3-r19-probes/): r19-dates2 (S rows), r19-dates
 * (W rows), r19-writer, r19-holdout (D and T rows) and r19-attack (DA and
 * TT rows).
 */

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind: kind as BriefFact["kind"],
  text,
  needs: needsFor(kind as BriefFact["kind"], text),
});

const sat = fact("date", "Saturday 5 December");
const sun = fact("date", "Sunday 6 December");
const price = fact("price", "₦2,000");

const copy = (
  subheadline: string | undefined,
  footerLines: string[] = [],
  cta?: string,
) => ({
  headline: "Christmas market",
  subheadline,
  footerLines,
  footerStyle: (footerLines.length ? "text" : "none") as "text" | "none",
  ...(cta ? { cta } : {}),
});

/* Whether `kept` is `original` with whole ranges cut out and nothing
   else changed: each kept sentence is a slice of the original, in order. */
function cutFrom(original: string, kept: string): boolean {
  let from = 0;
  for (const span of sentenceSpansOf(kept)) {
    const at = original.indexOf(kept.slice(span.start, span.end), from);
    if (at < 0) return false;
    from = at + (span.end - span.start);
  }
  return true;
}

describe("finding 1: every run of a date in a field is read", () => {
  const ROWS: [id: string, subheadline: string][] = [
    ["S1", "Saturday 5 December: crafts. Sunday 5 December: food."],
    ["S6", "Open Saturday 5 December. Crafts on Sunday morning, 5 December."],
    ["S7", "Sat 5 December for food, Sun 5 Dec for crafts"],
    ["W10", "Crafts… on Sunday, 5 December! Food Saturday 5 December?"],
  ];

  it.each(ROWS)(
    "%s: the field that also gives the date on the right day states nothing and is contradicted",
    (_id, subheadline) => {
      const design = copy(subheadline);
      expect(factStated(sat, design)).toBe(false);
      expect(contradictedDates([sat], design)).toEqual([
        expect.objectContaining({
          fact: "Saturday 5 December",
          field: "subheadline",
        }),
      ]);
    },
  );

  it("S3: a footer line is one field, whichever item holds the right day", () => {
    const design = copy("", ["Saturday 5 December · Food Sunday 5 December"]);
    expect(factStated(sat, design)).toBe(false);
    expect(contradictedDates([sat], design)).toHaveLength(1);
  });

  it("a field giving the date only on its own day still states it", () => {
    for (const subheadline of [
      "Open Saturday 5 December. Crafts all day.",
      "Saturday 5 December · crafts on Sunday",
      "Saturday 5 December. Back on 5 December 2026.",
    ]) {
      expect(factStated(sat, copy(subheadline))).toBe(true);
      expect(contradictedDates([sat], copy(subheadline))).toEqual([]);
    }
  });

  it("r19-writer: rewriteFault refuses the writer's fix that prepends the right day and keeps the wrong sentence", () => {
    const facts = [sat, sun, price];
    const before = copy(
      "Crafts on Sunday morning, 5 December. Food on Sunday 6 December.",
    );
    const after = copy(
      "Open Saturday 5 December. Crafts on Sunday morning, 5 December.",
      ["Food on Sunday 6 December · Entry ₦2,000"],
    );
    const ledger = factLedger([
      "Christmas market on Saturday 5 December and Sunday 6 December at Lekki. Crafts Saturday, food Sunday. Entry ₦2,000.",
    ]);
    expect(
      rewriteFault(
        { ...before, cta: "Book a table" },
        { ...after, cta: "Book a table" },
        facts,
        ledger,
      ),
    ).toMatch(/gives "5 December" with a weekday or year the brief does not/);
  });
});

describe("finding 2: a dropped sentence leaves the others byte for byte", () => {
  const ROWS: [id: string, input: string, kept: string, facts: BriefFact[]][] =
    [
      [
        "W1",
        "Open 9.30am to 5pm. Crafts on Sunday, 5 December.",
        "Open 9.30am to 5pm.",
        [sat],
      ],
      [
        "W2",
        "Shop early on adirehouse.ng. Crafts on Sunday, 5 December.",
        "Shop early on adirehouse.ng.",
        [sat, fact("contact", "adirehouse.ng")],
      ],
      [
        "W4",
        "Entry ₦2,000. Crafts on Sun. 5 Dec.",
        "Entry ₦2,000.",
        [sat, price],
      ],
      [
        "W7",
        "At St. Agnes Hall. Crafts on Sunday, 5 December.",
        "At St. Agnes Hall.",
        [sat],
      ],
      [
        "W11",
        "Entry ₦2,000. Crafts on Sunday 5 December, food too",
        "Entry ₦2,000.",
        [sat, price],
      ],
      [
        "middle sentence, its own separators kept",
        "Entry ₦2,000.  Crafts on Sunday, 5 December. Open 9.30am!",
        "Entry ₦2,000.  Open 9.30am!",
        [sat],
      ],
    ];

  it.each(ROWS)("%s", (_id, input, kept, facts) => {
    const r = withoutContradictedDates(copy(input), facts);
    expect(r.failed).toBe(false);
    expect(r.direction.subheadline).toBe(kept);
    expect(cutFrom(input, kept)).toBe(true);
    expect(r.settled).toEqual([
      expect.objectContaining({ field: "subheadline", action: "dropped" }),
    ]);
  });

  it("W2: the kept web address is still the brief's contact", () => {
    const site = fact("contact", "adirehouse.ng");
    const r = withoutContradictedDates(
      copy("Shop early on adirehouse.ng. Crafts on Sunday, 5 December."),
      [sat, site],
    );
    expect(r.direction.subheadline).toContain("adirehouse.ng");
  });

  it("a sentence that cannot be cut out alone takes the whole field with it", () => {
    for (const input of [
      "Sat 5 December for food, Sun 5 Dec for crafts",
      "Doors open. 5 December is Sunday, crafts all day.",
    ]) {
      const r = withoutContradictedDates(copy(input), [sat]);
      expect(r.failed).toBe(false);
      expect(r.direction.subheadline).toBeUndefined();
    }
  });

  it("W9: a fact the dropped sentence held is no longer stated", () => {
    const input =
      "Crafts on Sunday, 5 December, entry ₦2,000. Food on Sunday 6 December.";
    const before = copy(input);
    expect(factStated(price, before)).toBe(true);
    const r = withoutContradictedDates(before, [sat, sun, price]);
    expect(r.direction.subheadline).toBe("Food on Sunday 6 December.");
    expect(factStated(price, r.direction)).toBe(false);
    expect(factStated(sun, r.direction)).toBe(true);
  });
});

describe("sentenceSpansOf", () => {
  const sentences = (text: string) =>
    sentenceSpansOf(text).map((s) => text.slice(s.start, s.end));

  it("ends a sentence only before a capital or at the field's end", () => {
    expect(sentences("Open 9.30am to 5pm. Crafts on Sunday.")).toEqual([
      "Open 9.30am to 5pm.",
      "Crafts on Sunday.",
    ]);
    expect(sentences("Shop adirehouse.ng. Pay ₦4.5k.")).toEqual([
      "Shop adirehouse.ng.",
      "Pay ₦4.5k.",
    ]);
    expect(sentences("Crafts… on Sunday! Food? Yes")).toEqual([
      "Crafts… on Sunday!",
      "Food?",
      "Yes",
    ]);
  });

  it("never ends one after an abbreviation or an initial", () => {
    expect(
      sentences("At St. Agnes Hall. Sun. 5 Dec. Mr. J. Ade hosts."),
    ).toEqual(["At St. Agnes Hall.", "Sun. 5 Dec. Mr. J. Ade hosts."]);
  });
});

describe("finding 3: a day number in another clause with a word after it is a rival", () => {
  const REFUSED: [id: string, date: string, subheadline: string][] = [
    ["D5", "Friday 14 March", "Friday 14 March, or 21 if it rains."],
    [
      "D6",
      "Thursday 20 November",
      "Thursday 20 November, or 27 for the second group.",
    ],
    ["D7", "3 November", "Launching 3 November — 10 in Abuja."],
    [
      "DA",
      "Saturday 6 December",
      "Reopening Saturday 6 December (13 for the Ikoyi branch).",
    ],
    [
      "DA",
      "30 November",
      "Apply by 30 November — extended to 7 for referrals.",
    ],
    [
      "DA",
      "12 February",
      "Pre-orders close 12 February, 13 for corporate orders.",
    ],
    ["DA", "14 March", "Friday 14 March, or 4 if the hall is booked."],
  ];
  it.each(REFUSED)("%s: %s in %s is not stated", (_id, date, subheadline) => {
    expect(factStated(fact("date", date), copy(subheadline))).toBe(false);
  });

  const STATED: [date: string, subheadline: string][] = [
    ["Saturday 5 December", "Saturday 5 December, 12 stalls."],
    ["Saturday 5 December", "Saturday 5 December · 18+"],
    ["Saturday 5 December", "Saturday 5 December, 2 per table."],
    ["Saturday 5 December", "Saturday 5 December · 20% off crafts"],
    ["3 November", "Launching 3 November: twelve throws and cushions."],
    ["Saturday 5 December", "Saturday 5 December, 3 days of crafts."],
  ];
  it.each(STATED)("%s in %s is stated", (date, subheadline) => {
    expect(factStated(fact("date", date), copy(subheadline))).toBe(true);
  });
});

describe("finding 5: a contradicted footer line or sentence is found by where it stands", () => {
  it.each([
    ["W5", "Book now · Crafts Sunday 5 December"],
    ["W6", "Book now · crafts Sunday 5 December"],
  ])(
    "%s: the raw line behind a drawn line the renderer changed is left off, and the direction ships",
    (_id, line) => {
      const r = withoutContradictedDates(
        copy("Entry ₦2,000.", [line, "Lekki Leisure Lake"], "Book now"),
        [sat, price],
      );
      expect(r.failed).toBe(false);
      expect(r.direction.footerLines).toEqual(["Lekki Leisure Lake"]);
      expect(r.settled).toEqual([
        expect.objectContaining({ field: "footer line", action: "dropped" }),
      ]);
    },
  );

  it("W3: the wrong sentence goes, not the first one sharing its words", () => {
    const r = withoutContradictedDates(
      copy("Saturday 5 December is market day. Crafts on Sunday, 5 December."),
      [sat],
    );
    expect(r.direction.subheadline).toBe("Saturday 5 December is market day.");
    expect(factStated(sat, r.direction)).toBe(true);
  });

  it("duplicate wrong sentences around a right one: both wrong ones go", () => {
    const input =
      "Crafts on Sunday, 5 December. Saturday 5 December is market day. Crafts on Sunday, 5 December.";
    const r = withoutContradictedDates(copy(input), [sat]);
    expect(r.direction.subheadline).toBe("Saturday 5 December is market day.");
    expect(r.settled.map((s) => s.action)).toEqual(["dropped", "dropped"]);
    expect(factStated(sat, r.direction)).toBe(true);
  });
});

describe("KNOWN_COUNTED: a brief's own count beside its time is no rival", () => {
  const eightAm = fact("time", "from 8am");
  it.each([
    "From 8am. Three shots, one origin.",
    "From 8am, three shots, one origin.",
    "From 8am. Two slices each.",
    "From 8am, 24 slices a tray.",
  ])("%s states the time", (subheadline) => {
    expect(factStated(eightAm, copy(subheadline))).toBe(true);
  });
});
