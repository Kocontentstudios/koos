import { describe, expect, it } from "vitest";
import { generationFileName } from "@/lib/design/download-name";

const base = {
  id: "abcdef12-3456-4789-8abc-def123456789",
  designType: "Instagram post",
  width: 1080,
  height: 1350,
};

/* A folder of design-a1b2c3d4.png is unsortable and says nothing about which
   file is the portrait one. */
describe("generationFileName", () => {
  it("names the type and the size", () => {
    expect(generationFileName(base)).toBe(
      "instagram-post-1080x1350-abcdef12.png",
    );
  });

  it.each([
    ["Story / Reel", "story-reel"],
    ["  Spaced  Out  ", "spaced-out"],
    ["Ünïcode Ad", "unicode-ad"],
    ["!!!", "design"],
  ])("slugifies %j", (designType, expected) => {
    expect(generationFileName({ ...base, designType })).toContain(expected);
  });

  it("falls back when the type is missing", () => {
    expect(generationFileName({ ...base, designType: null })).toBe(
      "design-1080x1350-abcdef12.png",
    );
  });

  /* Older native rows carry no size; a guessed one in the filename would be a
     lie the user could act on. */
  it("omits the size rather than inventing one", () => {
    expect(generationFileName({ ...base, width: null, height: null })).toBe(
      "instagram-post-abcdef12.png",
    );
  });

  it("always ends in .png and never contains a path separator", () => {
    const name = generationFileName({ ...base, designType: "a/b\\c" });
    expect(name.endsWith(".png")).toBe(true);
    expect(name).not.toMatch(/[/\\]/);
  });

  /* designType is unbounded free text and lands in a Content-Disposition
     filename. */
  it("bounds a very long design type", () => {
    const name = generationFileName({ ...base, designType: "a".repeat(500) });
    expect(name.length).toBeLessThan(80);
    expect(name.endsWith(".png")).toBe(true);
    expect(name).not.toContain("--");
  });
});
