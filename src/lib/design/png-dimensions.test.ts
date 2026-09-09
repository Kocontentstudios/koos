import { describe, expect, it } from "vitest";
import { readPngDimensions } from "@/lib/design/png-dimensions";

/** A minimal but real PNG header: signature, length, "IHDR", width, height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

describe("readPngDimensions", () => {
  it.each([
    [1024, 1024],
    [1536, 1024],
    [2048, 2048],
    [4096, 4096],
  ])("reads %ix%i from the header", (width, height) => {
    expect(readPngDimensions(pngHeader(width, height))).toEqual({
      width,
      height,
    });
  });

  /* Every one of these would otherwise be reported as a real size and end up
     in the filename and the aspect box. */
  it.each([
    ["an empty buffer", new Uint8Array(0)],
    ["a truncated header", pngHeader(1024, 1024).slice(0, 20)],
    [
      "a JPEG",
      new Uint8Array([
        0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    ],
    ["plain text", new TextEncoder().encode("not an image at all ....")],
  ])("returns null for %s", (_case, bytes) => {
    expect(readPngDimensions(bytes)).toBeNull();
  });

  /* Zero is invalid per the spec and would render as a collapsed box. */
  it.each([
    [0, 1024],
    [1024, 0],
  ])("returns null for %ix%i", (width, height) => {
    expect(readPngDimensions(pngHeader(width, height))).toBeNull();
  });

  /* A corrupt header returning an unclamped uint32 reaches an int4 column and
     fails the UPDATE, marking a design that rendered fine as failed and
     orphaning the PNG already uploaded for it. */
  it.each([
    [0xffffffff, 0xffffffff],
    [2 ** 31, 1024],
    [1024, 2 ** 31],
  ])("returns null for the impossible size %ix%i", (width, height) => {
    expect(readPngDimensions(pngHeader(width, height))).toBeNull();
  });

  it("accepts the largest size PNG permits", () => {
    const max = 2 ** 31 - 1;
    expect(readPngDimensions(pngHeader(max, max))).toEqual({
      width: max,
      height: max,
    });
  });

  /* IHDR is required to come first; anything else is not a PNG we produced. */
  it("returns null when the first chunk is not IHDR", () => {
    const bytes = pngHeader(1024, 1024);
    bytes.set([0x74, 0x45, 0x58, 0x74], 12);
    expect(readPngDimensions(bytes)).toBeNull();
  });

  /* A view into a larger buffer must read from its own offset, not the
     buffer's start — Uint8Array.buffer is shared. */
  it("respects a byteOffset into a larger buffer", () => {
    const backing = new Uint8Array(64);
    backing.set(pngHeader(1536, 1024), 32);
    const view = backing.subarray(32);
    expect(readPngDimensions(view)).toEqual({ width: 1536, height: 1024 });
  });
});
