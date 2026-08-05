import { describe, expect, it } from "vitest";
import { buildImproveBriefPrompt } from "./improve-brief";

describe("buildImproveBriefPrompt", () => {
  it("carries the form context into the prompt", () => {
    const { system, prompt } = buildImproveBriefPrompt({
      requestType: "Flyer",
      title: "Launch",
      brandName: "Acme",
      brief: "need flyer for sat launch, red theme",
      specs: { platform: "Instagram" },
    });
    expect(prompt).toContain("Flyer");
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("red theme");
    expect(prompt).toContain("Instagram");
    expect(system.toLowerCase()).toContain("preserve");
  });

  it("omits empty context lines", () => {
    const { prompt } = buildImproveBriefPrompt({
      requestType: "Logo",
      title: "",
      brandName: "",
      brief: "geometric mark",
    });
    expect(prompt).not.toContain("Brand:");
    expect(prompt).not.toContain("Project title:");
  });
});
