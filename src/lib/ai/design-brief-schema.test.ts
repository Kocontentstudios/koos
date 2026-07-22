import { describe, expect, it } from "vitest";
import {
  designBriefSchema,
  designBriefUpdateSchema,
} from "./design-brief-schema";

const valid = {
  title: "Summer Sale Carousel",
  designType: "Instagram Carousel (1080x1350 per slide)",
  dimensions: "1080x1350",
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

describe("designBriefUpdateSchema", () => {
  it("accepts a partial update", () => {
    const parsed = designBriefUpdateSchema.parse({ title: "New title" });
    expect(parsed).toEqual({ title: "New title" });
  });

  it("allows clearing optional fields with null", () => {
    const parsed = designBriefUpdateSchema.parse({
      dimensions: null,
      slides: null,
      notes: null,
    });
    expect(parsed).toEqual({ dimensions: null, slides: null, notes: null });
  });

  it("rejects emptying required fields", () => {
    expect(designBriefUpdateSchema.safeParse({ title: "" }).success).toBe(
      false,
    );
    expect(
      designBriefUpdateSchema.safeParse({ briefMarkdown: "" }).success,
    ).toBe(false);
  });

  it("rejects an empty update", () => {
    expect(designBriefUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("rejects unknown fields like ticketId", () => {
    expect(designBriefUpdateSchema.safeParse({ ticketId: "t-1" }).success).toBe(
      false,
    );
  });
});
