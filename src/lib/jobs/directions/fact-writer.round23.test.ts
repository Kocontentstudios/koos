import { describe, expect, it } from "vitest";
import { buildFactWritePrompt, offeringFocus } from "./fact-writer";

/* Round-22 live run, cafe: every rewrite the offering ask drew was refused
   as a repeat. Design 0's writer named "cold brew flight" in the headline
   and again in the subheadline ("Your cold brew flight awaits" / "...enjoy
   your cold brew flight", 3 of the headline's 4 words); design 1's moved
   the headline to "Cold brew, your way." and named the flight below it.
   Neither was the headline's price; the round-22 path for a headline that
   moves onto the offering was never reached. The ask now says to name it
   once. */
describe("round 23: the offering ask names it once", () => {
  const offering = {
    kind: "product" as const,
    text: "cold brew flight",
    needs: ["^cold", "^brew", "^flight"],
  };

  it("tells the writer a headline that names it leaves the subheadline without it", () => {
    const [, once] = offeringFocus(offering);
    expect(once).toBe(
      'name it once: a headline that says any of "cold brew flight" leaves the subheadline without those words, and a subheadline that names it needs a headline that does not',
    );
  });

  it("keeps the last refusal after it", () => {
    expect(offeringFocus(offering, "it loses x").at(-1)).toBe(
      "the last rewrite was refused: it loses x",
    );
  });

  it("tells the writer a list of different items' prices may share a line", () => {
    const prompt = buildFactWritePrompt({
      requests: [],
      briefText: "b",
      title: "",
    } as never);
    expect(prompt).toContain(
      'Prices the brief gives for different items may share a line as a list, each amount right beside its own item\'s words from the brief ("Three tasters ₦6,000 · Bottle and two glasses ₦15,500")',
    );
  });
});
