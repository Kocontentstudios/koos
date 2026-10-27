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

/* The round-8 code critic's probes C5 and C6: a price written with
   another spelling of its currency was refused. */

describe("a price's currency is read through its aliases", () => {
  it.each([
    ["C5", "KSh 300 per plate", "KES 300 per plate"],
    ["C5 the other way", "KES 300 per plate", "KSh 300 per plate"],
    ["Ksh. with its stop", "Ksh. 300 per plate", "KES 300 per plate"],
    ["C6", "R250 per person", "ZAR 250 per person"],
    ["C6 the other way", "ZAR 250 per person", "R250 per person"],
    ["rand as a word", "R250 per person", "250 rand per person"],
    ["C7: thousands written with k", "₦4.5k a slice", "₦4,500 a slice"],
    ["C1: naira as N", "₦4,500 a slice", "N4500 a slice"],
  ] as const)("%s", (_label, text, copy) => {
    expect(factStated(fact("price", text), copy)).toBe(true);
  });

  it.each([
    ["shillings are not rand", "KSh 300 per plate", "R300 per plate"],
    ["rand are not naira", "R250 per person", "₦250 per person"],
    ["the unit still has to be there", "KSh 300 per plate", "KES 300"],
  ] as const)("%s", (_label, text, copy) => {
    expect(factStated(fact("price", text), copy)).toBe(false);
  });

  it("keeps no currency word as a need", () => {
    expect(needsFor("price", "KSh 300 per plate")).toEqual(["=300", "^plate"]);
    expect(needsFor("price", "R250 per person")).toEqual(["=250", "^person"]);
  });
});
