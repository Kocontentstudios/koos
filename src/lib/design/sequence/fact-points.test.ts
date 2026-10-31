import { describe, expect, it } from "vitest";
import { factPoints } from "./arc";
import { fact } from "./fixtures";

/* O1 round-1 critic, HIGH 3 and 4: the deck probe's outline had bare
   slides ("₦150 per kWh", "₦420 for diesel", "Ngozi Ade") cut from the
   brief's sentences. */
const BRIEF =
  "Lumenfield runs 6 solar mini-grids in Benue market towns. Customers pay ₦150 per kWh against ₦420 for diesel. We are raising $1.2M seed to build 14 more grids by end of 2027. Only 12 places. Contact Ngozi Ade, ngozi@lumenfield.ng.";
const FACTS = [
  fact("price", "₦150 per kWh"),
  fact("price", "₦420 for diesel"),
  fact("price", "$1.2M seed"),
  fact("quantity", "14 more grids"),
  fact("date", "By end of 2027"),
  fact("contact", "ngozi@lumenfield.ng"),
  fact("person", "Ngozi Ade"),
  fact("quantity", "12 places"),
];

describe("factPoints", () => {
  const points = factPoints({
    facts: FACTS,
    briefText: BRIEF,
    kind: "presentation",
    atAction: new Set([2]),
  });
  const texts = points.map((p) => p.text);

  it("gives two figures of one sentence as that sentence, one point", () => {
    expect(texts).toContain(
      "Customers pay ₦150 per kWh against ₦420 for diesel",
    );
    expect(texts).not.toContain("₦150 per kWh");
    expect(texts).not.toContain("₦420 for diesel");
  });

  it("gives the part of an ask's sentence beside the ask, with its date", () => {
    const grids = points.find((p) => p.text.includes("14 more grids"));
    expect(grids?.text).toBe("Build 14 more grids by end of 2027");
    expect(grids?.facts).toEqual([3, 4]);
  });

  it("gives no slide to the person the action names", () => {
    expect(texts.some((t) => /Ngozi/.test(t))).toBe(false);
  });

  it("keeps a fact that is its own sentence as it is", () => {
    expect(texts).toContain("Only 12 places");
  });
});
