import { describe, expect, it } from "vitest";
import {
  type BriefFact,
  type CoverKind,
  factStated,
  needsFor,
  withVenueOrBrand,
} from "./brief-facts";

const fact = (kind: CoverKind, text: string): BriefFact => ({
  kind,
  text,
  needs: needsFor(kind, text),
});

/* The round-8 code critic's probes P1 to P6: the brand's name stood in
   for a landmark ("Lekki toll gate" stated by "Brew Lab, Lekki"). */

describe("the brand stands in only for the brand's own venue", () => {
  const brand = "Brew Lab";
  const venue = (text: string) =>
    withVenueOrBrand([fact("place", text)], brand)[0];

  it.each([
    ["P2", "Lekki toll gate", "Brew Lab, Lekki"],
    ["P3", "Yaba bus stop", "Brew Lab Yaba"],
    ["P4", "Opposite the Lekki toll gate", "Brew Lab, Lekki"],
    ["P6", "Yaba market", "Brew Lab in Yaba"],
    [
      "a landmark even when it is ours",
      "our Yaba market stall",
      "Brew Lab, Yaba",
    ],
    ["no possessive, no stand-in", "Yaba bar", "Brew Lab, Yaba"],
  ] as const)("%s: %s is not stated by %s", (_label, text, copy) => {
    expect(factStated(venue(text), copy)).toBe(false);
  });

  it.each([
    ["P1", "our Yaba bar", "Brew Lab, Yaba"],
    [
      "P5",
      "our Ikoyi studio, 9 Bourdillon Road",
      "Brew Lab Ikoyi, 9 Bourdillon Road",
    ],
    ["capitalised possessive", "Our Yaba bar", "Brew Lab Yaba"],
    ["my", "my Lekki salon", "Brew Lab, Lekki"],
  ] as const)("%s: %s is stated by %s", (_label, text, copy) => {
    expect(factStated(venue(text), copy)).toBe(true);
  });

  it("leaves a landmark's needs as they were", () => {
    const gate = fact("place", "Lekki toll gate");
    expect(withVenueOrBrand([gate], brand)[0]).toEqual(gate);
  });
});

/* The round-9 code critic's venue probes (r9-verifier.log, P7 to P18). */
describe("the brand stands in only for its own premises (break 3)", () => {
  const brand = "Brew Lab";
  const venue = (text: string) =>
    withVenueOrBrand([fact("place", text)], brand)[0];

  it.each([
    ["P14", "our Surulere stall at the cinema", "Brew Lab, Surulere"],
    ["P18", "our Yaba bar in the shopping complex", "Brew Lab, Yaba"],
    ["P7", "our Yaba shopping centre", "Brew Lab, Yaba"],
    ["P9", "my Lekki hotel lobby", "Brew Lab, Lekki"],
    ["a centre", "our Ikeja centre", "Brew Lab, Ikeja"],
    ["a cinema", "our Lekki cinema", "Brew Lab, Lekki"],
    ["a complex", "our Yaba complex", "Brew Lab, Yaba"],
    ["a hotel", "our Ikoyi hotel", "Brew Lab, Ikoyi"],
    ["an unlisted noun", "our Yaba tech hub", "Brew Lab, Yaba"],
    [
      "inside a landmark",
      "our Ikeja kiosk inside the airport",
      "Brew Lab Ikeja",
    ],
    ["a word after the premises", "our Yaba bar upstairs", "Brew Lab, Yaba"],
  ] as const)("%s: %s is not stated by %s", (_label, text, copy) => {
    expect(factStated(venue(text), copy)).toBe(false);
  });

  it.each([
    ["P11: a new venue", "our new Yaba bar", "Brew Lab, Yaba"],
    [
      "P13: a place with a number",
      "our Lekki Phase 1 studio",
      "Brew Lab, Lekki Phase 1",
    ],
    [
      "the premises noun itself",
      "our Yaba stall at the cinema",
      "Yaba stall at the cinema",
    ],
    ["a branch", "our Ikeja branch", "Brew Lab Ikeja"],
  ] as const)("%s: %s is stated by %s", (_label, text, copy) => {
    expect(factStated(venue(text), copy)).toBe(true);
  });

  it("keeps a word after a preposition required", () => {
    expect(venue("our Surulere stall at the cinema").needs).toEqual(
      needsFor("place", "our Surulere stall at the cinema"),
    );
  });
});
