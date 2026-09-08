import { describe, expect, it } from "vitest";
import {
  detectImageType,
  IMAGE_MIME,
  isVisionReadable,
  VISION_IMAGE_TYPES,
} from "./detect";

const bytes = (...values: number[]) => new Uint8Array([...values, 0, 0, 0, 0]);
const text = (s: string) => new TextEncoder().encode(s);

const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0);
const GIF = bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);

describe("detectImageType reads the bytes, not the name", () => {
  it.each([
    ["PNG", PNG, "png"],
    ["JPEG", JPEG, "jpeg"],
    ["GIF", GIF, "gif"],
    ["WEBP", WEBP, "webp"],
  ])("recognises %s", (_label, input, expected) => {
    expect(detectImageType(input)).toBe(expected);
  });

  it("returns null for something that is not an image", () => {
    expect(detectImageType(text("just some text"))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });

  /* RIFF alone is not WEBP — it is also WAV and AVI. Both markers must match
     or an audio file would be handed to a vision model as an image. */
  it("does not mistake another RIFF container for WEBP", () => {
    const wav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectImageType(wav)).toBeNull();
  });
});

/* SVG is text with no magic number, and it is the format that made
   KOOS-BUG-014: /api/upload accepts image/svg+xml for logos, so a vector logo
   has to be recognised before it can be rasterised. */
describe("SVG detection", () => {
  it.each([
    ["a bare root element", '<svg xmlns="http://www.w3.org/2000/svg"></svg>'],
    ["an XML declaration first", '<?xml version="1.0"?><svg width="10"></svg>'],
    ["a doctype first", "<!DOCTYPE svg><svg></svg>"],
    ["a leading comment", "<!-- exported by a tool --><svg></svg>"],
    ["leading whitespace", "\n\n  <svg></svg>"],
    ["an uppercase tag", "<SVG></SVG>"],
  ])("recognises SVG with %s", (_label, source) => {
    expect(detectImageType(text(source))).toBe("svg");
  });

  /* The word "svg" in prose is not an SVG file — the tag has to be a tag. */
  it.each([
    "a document about svg files",
    "<svgnot>something else</svgnot>",
    "<html><body>svg</body></html>",
  ])("does not call %s an SVG", (source) => {
    expect(detectImageType(text(source))).toBeNull();
  });

  /* Some exporters emit kilobytes of comments or metadata before the root
     element; the sniff window has to be generous enough to reach it. */
  it("finds the tag after a long preamble", () => {
    const preamble = `<!--${"x".repeat(700)}-->`;
    expect(detectImageType(text(`${preamble}<svg></svg>`))).toBe("svg");
  });
});

describe("which types a vision model can read", () => {
  it("accepts the raster formats", () => {
    for (const type of VISION_IMAGE_TYPES) {
      expect(isVisionReadable(type)).toBe(true);
    }
  });

  /* The whole point of the bug: SVG is recognised, and is NOT readable — it
     has to be rasterised first. */
  it("refuses SVG", () => {
    expect(isVisionReadable("svg")).toBe(false);
  });

  it("refuses an unrecognised file", () => {
    expect(isVisionReadable(null)).toBe(false);
  });

  it("has a MIME type for every type it can name", () => {
    for (const type of [...VISION_IMAGE_TYPES, "svg"] as const) {
      expect(IMAGE_MIME[type]).toMatch(/^image\//);
    }
  });
});
