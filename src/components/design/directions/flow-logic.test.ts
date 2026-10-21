import { describe, expect, it } from "vitest";
import {
  designImageProblem,
  formatBytes,
  generationStepIndex,
  generationSteps,
  isUnusableImageError,
  MAX_DESIGN_IMAGE_BYTES,
  uploadNameFor,
} from "./flow-logic";

function file(name: string, type: string, bytes = 1024): File {
  const f = new File(["x"], name, { type });
  Object.defineProperty(f, "size", { value: bytes });
  return f;
}

describe("designImageProblem", () => {
  it.each([
    ["shot.png", "image/png"],
    ["shot.jpg", "image/jpeg"],
    ["shot.webp", "image/webp"],
  ])("accepts %s", (name, type) => {
    expect(designImageProblem(file(name, type))).toBeNull();
  });

  it.each([
    ["shot.heic", "image/heic"],
    ["logo.svg", "image/svg+xml"],
    ["notes.pdf", "application/pdf"],
  ])("refuses %s by name", (name, type) => {
    expect(designImageProblem(file(name, type))).toContain(name);
  });

  /* Some platforms hand over no MIME at all; the name is all there is. */
  it("falls back to the extension when the type is empty", () => {
    expect(designImageProblem(file("phone.JPEG", ""))).toBeNull();
    expect(designImageProblem(file("phone.heic", ""))).not.toBeNull();
  });

  it("allows exactly 20 MB and refuses a byte more", () => {
    expect(
      designImageProblem(file("a.png", "image/png", MAX_DESIGN_IMAGE_BYTES)),
    ).toBeNull();
    expect(
      designImageProblem(
        file("a.png", "image/png", MAX_DESIGN_IMAGE_BYTES + 1),
      ),
    ).toMatch(/limit is 20 MB/);
  });

  it("refuses an empty file", () => {
    expect(designImageProblem(file("a.png", "image/png", 0))).toMatch(/empty/);
  });
});

describe("uploadNameFor", () => {
  it("renames a WEBP that was re-encoded to JPEG", () => {
    expect(uploadNameFor("cake.webp", "image/jpeg")).toBe("cake.jpg");
  });
  it("keeps a PNG a PNG", () => {
    expect(uploadNameFor("cut.out.png", "image/png")).toBe("cut.out.png");
  });
  it("never produces a bare extension", () => {
    expect(uploadNameFor(".png", "image/png")).toBe("image.png");
  });
});

describe("formatBytes", () => {
  it("reads in KB under a megabyte and MB above", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(900 * 1024)).toBe("900 KB");
    expect(formatBytes(2.25 * 1024 * 1024)).toBe("2.3 MB");
  });
});

describe("generationStepIndex", () => {
  it("sits on the first step until the worker reports anything", () => {
    expect(generationStepIndex(null, null)).toBe(0);
    expect(generationStepIndex("starting", null)).toBe(0);
  });
  it("moves to art direction on the first report", () => {
    expect(generationStepIndex("running", { done: 0, total: 3 })).toBe(1);
  });
  it("moves to building once any unit is done", () => {
    expect(generationStepIndex("running", { done: 1, total: 3 })).toBe(2);
    expect(generationStepIndex("running", { done: 3, total: 3 })).toBe(2);
  });
  it("finishes only when the job is done and rows are being read", () => {
    expect(generationStepIndex("fetching", { done: 3, total: 3 })).toBe(3);
    expect(generationStepIndex("fetching", null)).toBe(3);
  });
});

describe("generationSteps", () => {
  it("names the imagery step after the source", () => {
    expect(generationSteps("upload")[2].long).toMatch(/your image/);
    expect(generationSteps("ko")[2].long).toMatch(/Creating imagery/);
    expect(generationSteps("ko")).toHaveLength(4);
  });
});

describe("isUnusableImageError", () => {
  it("matches the server sentence with either apostrophe", () => {
    expect(isUnusableImageError("This image can't be used.")).toBe(true);
    expect(
      isUnusableImageError("This image can’t be used. Choose a PNG."),
    ).toBe(true);
  });
  it("does not match other failures", () => {
    expect(isUnusableImageError("Design generation failed.")).toBe(false);
    expect(isUnusableImageError(null)).toBe(false);
  });
});
