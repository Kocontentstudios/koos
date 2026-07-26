import { describe, expect, it } from "vitest";
import { buildImagePrompt } from "./image";

describe("buildImagePrompt", () => {
  it("weaves in brand fields when they are present", () => {
    const brand = {
      id: "test-id",
      userId: "user-id",
      workspaceId: "ws-id",
      name: "Nimbus Coffee",
      tone: "warm and inviting",
      primaryColor: "#8B4513",
      brandStyle: "minimal and modern",
      offer: "cold brew concentrate delivered fresh",
    };

    const userPrompt = "a launch banner for cold brew";

    const result = buildImagePrompt({
      brand,
      userPrompt,
    });

    expect(result).toContain(userPrompt);
    expect(result).toContain("Nimbus Coffee");
    expect(result).toContain("warm and inviting");
    expect(result).toContain("minimal and modern");
    expect(result).toContain("#8B4513");
    expect(result).toContain("cold brew concentrate delivered fresh");
  });

  it("returns only the user prompt when brand fields are all null", () => {
    const brand = {
      id: "test-id",
      userId: "user-id",
      workspaceId: "ws-id",
      name: "Test Brand",
      tone: null,
      primaryColor: null,
      secondaryColor: null,
      brandStyle: null,
      offer: null,
    };

    const userPrompt = "a minimalist poster design";

    const result = buildImagePrompt({
      brand,
      userPrompt,
    });

    expect(result).toContain(userPrompt);
    expect(result).not.toContain("undefined");
    expect(result).not.toContain("null");
  });

  it("filters out empty string fields", () => {
    const brand = {
      id: "test-id",
      userId: "user-id",
      workspaceId: "ws-id",
      name: "Empty Brand",
      tone: "",
      primaryColor: "",
      brandStyle: "",
      offer: "",
    };

    const userPrompt = "a product photo";

    const result = buildImagePrompt({
      brand,
      userPrompt,
    });

    expect(result).toContain(userPrompt);
    expect(result).not.toContain("undefined");
  });

  it("includes secondary color when present", () => {
    const brand = {
      id: "test-id",
      userId: "user-id",
      workspaceId: "ws-id",
      name: "Colorful Brand",
      primaryColor: "#FF6B6B",
      secondaryColor: "#4ECDC4",
      tone: null,
      brandStyle: null,
      offer: null,
    };

    const userPrompt = "vibrant gradient background";

    const result = buildImagePrompt({
      brand,
      userPrompt,
    });

    expect(result).toContain(userPrompt);
    expect(result).toContain("#FF6B6B");
    expect(result).toContain("#4ECDC4");
  });

  it("accepts brand as a partial object subset", () => {
    const brand = {
      name: "Subset Brand",
      tone: "professional",
    };

    const userPrompt = "corporate headshot";

    const result = buildImagePrompt({
      brand,
      userPrompt,
    });

    expect(result).toContain(userPrompt);
    expect(result).toContain("professional");
  });
});
