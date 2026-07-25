import { describe, expect, it } from "vitest";
import { ProposalSchema } from "./proposals";

describe("ProposalSchema", () => {
  it("accepts a brand_fields proposal", () => {
    const p = { kind: "brand_fields", summary: "Set tone to playful",
      data: { fields: { tone: "playful" } } };
    expect(ProposalSchema.safeParse(p).success).toBe(true);
  });
  it("accepts a design_ticket proposal", () => {
    const p = { kind: "design_ticket", summary: "IG carousel",
      data: { designType: "Instagram Carousel", brief: "5 slides on launch" } };
    expect(ProposalSchema.safeParse(p).success).toBe(true);
  });
  it("rejects an unknown kind", () => {
    expect(ProposalSchema.safeParse({ kind: "nope", summary: "x", data: {} }).success).toBe(false);
  });
  it("rejects a design_ticket missing brief", () => {
    const p = { kind: "design_ticket", summary: "x", data: { designType: "Logo" } };
    expect(ProposalSchema.safeParse(p).success).toBe(false);
  });
});
