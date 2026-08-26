import { describe, expect, it } from "vitest";
import {
  type BrandSummary,
  buildStrategistSystemPrompt,
  buildStrategyGenerationPrompt,
} from "./strategy";

const brand: BrandSummary = {
  name: "Lagos Loom",
  overview: "Handwoven aso-oke bags",
  targetAudience: "Nigerian women 25-40",
  tone: "Warm and confident",
};

describe("buildStrategyGenerationPrompt", () => {
  const prompt = buildStrategyGenerationPrompt(
    "user: launching the Ìtàn tote",
    brand,
  );

  it("carries the brand context and the conversation", () => {
    expect(prompt).toContain("Lagos Loom");
    expect(prompt).toContain("Handwoven aso-oke bags");
    expect(prompt).toContain("launching the Ìtàn tote");
  });

  /* One chat = one campaign. Without this instruction the model merges every
     topic mentioned into a catch-all plan, which is the mixing failure the
     eval measures. */
  it("constrains the output to a single campaign focus", () => {
    expect(prompt).toContain("ONE campaign");
    expect(prompt).toMatch(
      /one main goal, product, service, offer, event or message/,
    );
  });

  it("states the campaign-name rules the card and sidebar depend on", () => {
    expect(prompt).toContain("60 characters");
    expect(prompt).toContain("Campaign for");
  });

  it("still asks for every field the schema requires", () => {
    for (const field of [
      "measurable objective",
      "target audience",
      "key message",
      "channels",
      "content mix",
      "timeline",
      "themes",
      "posting schedule",
    ]) {
      expect(prompt.toLowerCase()).toContain(field.toLowerCase());
    }
  });
});

describe("buildStrategistSystemPrompt", () => {
  it("names the brand and points at the Build Strategy action", () => {
    const system = buildStrategistSystemPrompt(brand);
    expect(system).toContain("Lagos Loom");
    expect(system).toContain("Build Strategy");
  });
});
