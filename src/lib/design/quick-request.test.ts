import { describe, expect, it } from "vitest";
import {
  buildQuickRequestConversation,
  fallbackQuickBrief,
  type QuickRequestInput,
  quickRequestSchema,
} from "./quick-request";

const base: QuickRequestInput = {
  businessName: "Ada Bakes",
  designType: "Instagram Post (1080x1350)",
  description: "A launch announcement for our new sourdough range.",
};

describe("quickRequestSchema", () => {
  it("accepts a minimal valid request", () => {
    expect(quickRequestSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a description that is too short to brief from", () => {
    const result = quickRequestSchema.safeParse({
      ...base,
      description: "logo",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed delivery email", () => {
    const result = quickRequestSchema.safeParse({
      ...base,
      deliveryEmail: "not-an-email",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid delivery email", () => {
    const result = quickRequestSchema.safeParse({
      ...base,
      deliveryEmail: "hello@adabakes.com",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a slide count outside 2-10", () => {
    expect(quickRequestSchema.safeParse({ ...base, slides: 11 }).success).toBe(
      false,
    );
  });
});

describe("buildQuickRequestConversation", () => {
  it("includes the business name, design type and description", () => {
    const text = buildQuickRequestConversation(base);
    expect(text).toContain("Ada Bakes");
    expect(text).toContain("Instagram Post (1080x1350)");
    expect(text).toContain("new sourdough range");
  });

  it("states that the brand profile is incomplete so the model does not invent facts", () => {
    expect(buildQuickRequestConversation(base)).toContain("not invent");
  });

  it("includes slides only for carousel types", () => {
    const carousel = buildQuickRequestConversation({
      ...base,
      designType: "Instagram Carousel (1080x1350 per slide)",
      slides: 5,
    });
    expect(carousel).toContain("Slides: 5");

    const post = buildQuickRequestConversation({ ...base, slides: 5 });
    expect(post).not.toContain("Slides: 5");
  });

  it("omits optional lines that were not provided", () => {
    const text = buildQuickRequestConversation(base);
    expect(text).not.toContain("Reference image");
    expect(text).not.toContain("Dimensions");
  });
});

describe("fallbackQuickBrief", () => {
  it("carries the user's own description into a markdown brief", () => {
    const brief = fallbackQuickBrief(base);
    expect(brief).toContain("**Details**");
    expect(brief).toContain("new sourdough range");
  });

  it("flags to the designer that the brand profile is incomplete", () => {
    expect(fallbackQuickBrief(base)).toContain(
      "without a completed brand profile",
    );
  });
});
