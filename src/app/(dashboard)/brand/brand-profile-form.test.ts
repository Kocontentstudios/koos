import { describe, expect, it } from "vitest";
import { parseAdditionalColors } from "@/lib/brand-profile";
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

  /* The AI confirm path writes additionalColors through parseAdditionalColors,
     which never hex-validates, so a brand can legitimately hold "terracotta".
     Rejecting it here made that brand un-saveable from this form forever — the
     same trap the primary/secondary exemption below exists to avoid. */
  it("accepts a non-hex entry so a conversational brand stays saveable", () => {
    expect(parse(["#AA0000", "chartreuse"]).success).toBe(true);
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

  /* The schema bounds the count, not the entry — isValidHex used to cap each
     one at 7 chars incidentally. saveBrandProfile is a server action taking
     unknown input, so the length bound has to come from parseAdditionalColors
     on the server, not from the form. */
  it("bounds an oversized entry once the server sanitiser runs", () => {
    const huge = "x".repeat(200_000);
    const parsed = parse([huge]);
    expect(parsed.success).toBe(true);
    const stored = parseAdditionalColors(
      parsed.success ? parsed.data.additionalColors : [],
    );
    expect(stored[0].length).toBeLessThanOrEqual(40);
  });
});
