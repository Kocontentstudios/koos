import { describe, expect, it } from "vitest";
import { designBriefSchema } from "./design-brief-schema";

const valid = {
  title: "Summer Sale Carousel",
  designType: "Instagram Carousel (1080x1080 per slide)",
  dimensions: "1080x1080",
  slides: 5,
  briefMarkdown: "**Title**\nSummer Sale\n\n**Objective**\nDrive signups",
};

describe("designBriefSchema", () => {
  it("accepts a complete brief", () => {
    expect(designBriefSchema.parse(valid)).toMatchObject(valid);
  });

  it("accepts a minimal brief without optional fields", () => {
    expect(() =>
      designBriefSchema.parse({
        title: "Flyer",
        designType: "Other",
        briefMarkdown: "**Request Title**\nFlyer",
      }),
    ).not.toThrow();
  });

  it("rejects an empty briefMarkdown", () => {
    expect(
      designBriefSchema.safeParse({ ...valid, briefMarkdown: "" }).success,
    ).toBe(false);
  });

  it("bounds slides to 2-10", () => {
    expect(designBriefSchema.safeParse({ ...valid, slides: 1 }).success).toBe(
      false,
    );
    expect(designBriefSchema.safeParse({ ...valid, slides: 11 }).success).toBe(
      false,
    );
  });
});
