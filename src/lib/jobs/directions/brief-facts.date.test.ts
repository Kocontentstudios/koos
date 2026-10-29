import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
} from "./brief-facts";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

/* The round-9 code critic's date probes (r9-verifier.log, FP3 to FP12). */

describe("an hour, a marked number or a count is never a date's day (break 2)", () => {
  it.each([
    ["FP3", "Saturday 5 December", "Saturday 12 December, 5pm"],
    ["FP4", "Saturday 5 December", "Saturday 12 December 5pm till late"],
    ["FP5", "5 December", "Opens 12 December, 5 tables left"],
    ["FP11", "Friday 5 December", "Friday 12 December, 5pm"],
    ["FP12", "5 December", "12 December, 5 pm"],
    ["the month has its day already", "December 5", "12 December 5 stalls"],
    ["a count after the month", "December 5", "Opens December 5+ stalls"],
  ] as const)("%s: %s is not stated by %s", (_label, text, copy) => {
    expect(factStated(fact("date", text), copy)).toBe(false);
  });

  it.each([
    [
      "the date with its hour",
      "Saturday 5 December",
      "Saturday 5 December, 5pm",
    ],
    ["month first", "5 December", "December 5 from 2pm"],
    ["FN10: an ordinal", "5 December", "5th December"],
    ["FN11", "Saturday 5 December", "Sat 5th Dec"],
    ["of the month", "5 December", "5th of December"],
  ] as const)("%s: %s is stated by %s", (_label, text, copy) => {
    expect(factStated(fact("date", text), copy)).toBe(true);
  });
});
