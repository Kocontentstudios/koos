import { describe, expect, it } from "vitest";
import { BLANK_MAX_BYTES_PER_PIXEL, checkRenderedDesign } from "./checks";

/* KOOS-AI-001 §1.6. Until now nothing looked at a design before it was
   delivered: the job succeeded when "at least one variant produced bytes", and
   the faults it did detect — an illegible logo, a font that fell back — were
   notifications sent AFTER the image was stored and shown to the user. The
   offline evals already knew how to compute most of this and were never
   invoked at runtime. */

/** A PNG of a given byte length, with a real header so the size reads back. */
function png(width: number, height: number, byteLength: number): Uint8Array {
  const bytes = new Uint8Array(Math.max(byteLength, 33));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

/** Dense enough to pass the blank check at this size. */
const real = (w: number, h: number) =>
  png(w, h, Math.ceil(w * h * BLANK_MAX_BYTES_PER_PIXEL * 4));

const expected = { width: 1080, height: 1080 };

describe("checkRenderedDesign", () => {
  it("passes a design that is the right size and carries detail", () => {
    const result = checkRenderedDesign({
      bytes: real(1080, 1080),
      expected,
      logoLegible: true,
    });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  /* A flat frame is a rendering failure that still returns 200 — the image
     model refused, or the plate came back empty — and it was delivered as a
     finished design. */
  it("catches a blank frame", () => {
    const result = checkRenderedDesign({
      bytes: png(1080, 1080, 400),
      expected,
      logoLegible: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("blank-frame");
  });

  /* The adapters substitute aspect ratios they cannot serve — Google swaps 3:4
     for 4:5 — so the bytes that come back are not always the canvas that was
     asked for. */
  it("catches a design that came back the wrong shape", () => {
    const result = checkRenderedDesign({
      bytes: real(1080, 1350),
      expected,
      logoLegible: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("wrong-dimensions");
  });

  /* Upscaling is routine and harmless; the shape is what matters, so a 2K
     render of the same aspect ratio must not be reported as wrong. */
  it("accepts a larger render of the same shape", () => {
    const result = checkRenderedDesign({
      bytes: real(2160, 2160),
      expected,
      logoLegible: true,
    });

    expect(result.ok).toBe(true);
  });

  it("reports a logo the compositor could not make legible", () => {
    const result = checkRenderedDesign({
      bytes: real(1080, 1080),
      expected,
      logoLegible: false,
    });

    expect(result.failures.map((f) => f.code)).toContain("unreadable-logo");
  });

  /* Bytes that are not an image at all read as no dimensions. Treating that as
     "fine" would deliver a broken file. */
  it("fails bytes it cannot read as an image", () => {
    const result = checkRenderedDesign({
      bytes: new Uint8Array([1, 2, 3, 4]),
      expected,
      logoLegible: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("unreadable-image");
  });

  /* A renderer that returned nothing at all must read as a fault, not throw
     on the way to reporting one. */
  it.each([undefined, new Uint8Array()])("fails on %s bytes", (bytes) => {
    const result = checkRenderedDesign({
      bytes: bytes as Uint8Array,
      expected,
      logoLegible: true,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.map((f) => f.code)).toContain("unreadable-image");
  });

  it("reports every fault at once rather than only the first", () => {
    const result = checkRenderedDesign({
      bytes: png(1080, 1350, 400),
      expected,
      logoLegible: false,
    });

    expect(result.failures.map((f) => f.code).sort()).toEqual([
      "blank-frame",
      "unreadable-logo",
      "wrong-dimensions",
    ]);
  });

  /* The fault has to say what went wrong in words a correction pass can act
     on: "wrong-dimensions" alone cannot tell a model what to change. */
  it("explains each fault, not just names it", () => {
    const result = checkRenderedDesign({
      bytes: real(1080, 1350),
      expected,
      logoLegible: true,
    });

    expect(result.failures[0].detail).toMatch(/1080x1350|1080x1080/);
  });
});
