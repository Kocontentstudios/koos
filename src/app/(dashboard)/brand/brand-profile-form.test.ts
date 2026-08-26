import { describe, expect, it } from "vitest";
import { brandProfileSchema } from "./brand-profile-form";

const base = {
  name: "Lagos Loom",
  overview: "Handwoven textiles made in Lagos for modern homes.",
  businessType: "Product",
  stage: "Growing",
};

function parse(additionalColors: unknown) {
  return brandProfileSchema.safeParse({ ...base, additionalColors });
}

describe("brandProfileSchema additionalColors", () => {
  it("accepts up to three valid hexes", () => {
    expect(parse(["#AA0000", "#BB0000", "#CC0000"]).success).toBe(true);
  });

  it("accepts the field being absent or empty", () => {
    expect(brandProfileSchema.safeParse(base).success).toBe(true);
    expect(parse([]).success).toBe(true);
  });

  it("rejects a fourth color — the cap is enforced on the server", () => {
    expect(parse(["#AA0000", "#BB0000", "#CC0000", "#DD0000"]).success).toBe(
      false,
    );
  });

  it("rejects a non-hex entry from the form path", () => {
    expect(parse(["#AA0000", "chartreuse"]).success).toBe(false);
  });

  /* The conversational path writes colour names straight to the DB, so an
     existing brand can hold "green". Tightening these would make that brand
     un-saveable the next time its owner opens the form. */
  it("still accepts a non-hex primary/secondary so legacy brands stay saveable", () => {
    const res = brandProfileSchema.safeParse({
      ...base,
      primaryColor: "green",
      secondaryColor: "cream",
    });
    expect(res.success).toBe(true);
  });
});
