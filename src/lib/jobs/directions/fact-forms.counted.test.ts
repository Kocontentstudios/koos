import { describe, expect, it } from "vitest";
import { DIRECTIONS_EVAL_CASES } from "@/lib/ai/design-directions/eval/cases";
import { tokensOf } from "@/lib/design/copy-tokens";
import { type BriefFact, factStated, needsFor } from "./brief-facts";

/*
 * KNOWN_COUNTED (fact-forms.ts) is closed: a number before a noun it does
 * not list is taken for a rival hour or day. So every count an eval brief
 * gives must stand beside a time and a date, or the eval refuses its own
 * brief's facts whenever the model puts them in one field ("From 8am.
 * Three shots, one origin", round-19 critic, T66). A brief that counts a
 * new noun fails here until the noun is listed.
 */

const MONTH = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*$/i;
const ADDRESS = /^(way|avenue|street|road|close|crescent|market)$/i;
const NOT_A_COUNT = ["and", "to", "or"];

/* Each count an eval brief gives: a number, not a phone's digit group,
   and the words right after it, up to three. */
function briefCounts(): string[] {
  const counts = new Set<string>();
  for (const c of DIRECTIONS_EVAL_CASES) {
    const tokens = tokensOf(c.request.briefText);
    tokens.forEach((t, i) => {
      if (t.kind !== "number" || /^0\d/.test(t.text)) return;
      if (tokens[i - 1]?.kind === "number") return;
      const words: string[] = [];
      for (let j = i + 1; j < i + 4 && tokens[j]?.kind === "word"; j += 1) {
        words.push(tokens[j].text);
      }
      if (words.length === 0 || NOT_A_COUNT.includes(words[0].toLowerCase())) {
        return;
      }
      if (words.some((w) => MONTH.test(w) || ADDRESS.test(w))) return;
      counts.add(`${t.text} ${words.join(" ")}`);
    });
  }
  return [...counts];
}

const fact = (kind: BriefFact["kind"], text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

const design = (subheadline: string) => ({
  headline: "Open",
  subheadline,
  footerLines: [],
  footerStyle: "none" as const,
});

describe("every count an eval brief gives stands beside a time and a date", () => {
  const counts = briefCounts();

  it("finds the briefs' counts", () => {
    expect(counts).toEqual(
      expect.arrayContaining([
        "three shots for",
        "Twelve new throws and",
        "one artisan in Iseyin",
        "two senior React engineers",
        "10 seats",
      ]),
    );
  });

  it.each(counts)("%s", (count) => {
    expect(
      factStated(fact("time", "from 8am"), design(`From 8am, ${count}.`)),
    ).toBe(true);
    expect(
      factStated(
        fact("date", "Saturday 5 December"),
        design(`Saturday 5 December, ${count}.`),
      ),
    ).toBe(true);
  });
});
