import { describe, expect, it } from "vitest";
import { buildChatPrompt } from "./chat";

describe("buildChatPrompt (tool-aware)", () => {
  it("instructs the model to use tools and to propose, not fabricate", () => {
    const p = buildChatPrompt({ memorySummary: "Acme sells running shoes." });
    expect(p).toMatch(/tool/i);
    expect(p).toMatch(/propose/i);
    expect(p).toContain("Acme sells running shoes.");
  });
});
