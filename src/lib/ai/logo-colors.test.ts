import { beforeEach, describe, expect, it, vi } from "vitest";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import { extractLogoColors } from "@/lib/ai/logo-colors";

const IMAGE = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png" };

describe("extractLogoColors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObject.mockResolvedValue({
      object: {
        primary: "#3a2a1f",
        secondary: "#faf7f2",
        accents: ["#d4b8a0"],
      },
    });
  });

  it("returns the palette, normalised", () => {
    return expect(extractLogoColors(IMAGE)).resolves.toEqual({
      primary: "#3A2A1F",
      secondary: "#FAF7F2",
      accents: ["#D4B8A0"],
    });
  });

  it("sends the image bytes to the model", async () => {
    await extractLogoColors(IMAGE);

    const call = generateObject.mock.calls[0][0];
    const parts = call.messages[0].content;
    const imagePart = parts.find((p: { type: string }) => p.type === "image");
    expect(imagePart.image).toBe(IMAGE.bytes);
    expect(imagePart.mediaType).toBe("image/png");
  });

  /* Colours are stored unvalidated elsewhere on purpose, but a value invented
     by a model is not the user's word for it — a non-hex answer must
     contribute nothing rather than poison the profile. */
  it("drops anything that is not a hex", async () => {
    generateObject.mockResolvedValue({
      object: {
        primary: "warm terracotta",
        secondary: "#FFF",
        accents: ["not a colour", "#123456"],
      },
    });

    expect(await extractLogoColors(IMAGE)).toEqual({
      primary: null,
      secondary: "#FFFFFF",
      accents: ["#123456"],
    });
  });

  it("treats an empty answer as no answer", async () => {
    generateObject.mockResolvedValue({
      object: { primary: "", secondary: "", accents: [] },
    });

    expect(await extractLogoColors(IMAGE)).toEqual({
      primary: null,
      secondary: null,
      accents: [],
    });
  });

  /* This is the codebase's first multimodal call, and an openai-compatible
     endpoint pointed at a text-only model will reject the image part. That
     must degrade to manual entry, never block the step. */
  it("returns empty rather than throwing when the provider refuses", async () => {
    generateObject.mockRejectedValue(
      new Error("model does not support images"),
    );

    expect(await extractLogoColors(IMAGE)).toEqual({
      primary: null,
      secondary: null,
      accents: [],
    });
  });

  it("caps its own output", async () => {
    await extractLogoColors(IMAGE);
    expect(generateObject.mock.calls[0][0].maxOutputTokens).toBe(500);
  });
});
