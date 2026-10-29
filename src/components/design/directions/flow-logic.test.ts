import { describe, expect, it } from "vitest";
import { DesignImageError } from "@/lib/uploads/design-image";
import {
  MAX_DESIGN_IMAGE_BYTES,
  MAX_DESIGN_IMAGE_SIDE,
} from "@/lib/uploads/design-image-limits";
import { ImageNotUsableError } from "@/lib/uploads/normalize-image";
import {
  designImageProblem,
  formatBytes,
  generationStepIndex,
  generationSteps,
  isUnusableImageError,
  offeredSources,
  resultsHeading,
  startOverLabel,
  unusableImageDetail,
  unusableImageReason,
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

describe("formatBytes", () => {
  it("reads in KB under a megabyte and MB above", () => {
    expect(formatBytes(512)).toBe("1 KB");
    expect(formatBytes(900 * 1024)).toBe("900 KB");
    expect(formatBytes(2.25 * 1024 * 1024)).toBe("2.3 MB");
  });
});

describe("generationSteps", () => {
  it("has four steps on the KO path, one per job stage", () => {
    expect(generationSteps("ko").map((s) => s.stage)).toEqual([
      "brief",
      "imagery",
      "render",
      "checks",
    ]);
  });

  /* The upload path never runs imagery; a step that is always skipped would
     read as one that failed. */
  it("has no imagery step on the upload path", () => {
    const steps = generationSteps("upload");
    expect(steps.map((s) => s.stage)).toEqual(["brief", "render", "checks"]);
    expect(steps[1].long).toMatch(/your image/);
  });

  it("has no imagery step on the text-led path, and says the words lead", () => {
    const steps = generationSteps("none");
    expect(steps.map((s) => s.stage)).toEqual(["brief", "render", "checks"]);
    expect(steps[1].long).toMatch(/your words/);
    expect(steps.map((s) => s.long).join(" ")).not.toMatch(/image/i);
  });
});

/* Oluwaseyi's ruling, 2026-10-27: no KO imagery in the UI while
   FEATURE_KO_IMAGERY is off. */
describe("offeredSources", () => {
  it("offers the upload and KO imagery when the flag is on", () => {
    expect(offeredSources(true)).toEqual(["upload", "ko"]);
  });

  it("offers the upload and no image, never KO, when the flag is off", () => {
    expect(offeredSources(false)).toEqual(["upload", "none"]);
    expect(offeredSources(false)).not.toContain("ko");
  });
});

describe("generationStepIndex", () => {
  const ko = generationSteps("ko");
  const upload = generationSteps("upload");

  it("sits on the first step until the job reports a stage", () => {
    expect(generationStepIndex(ko, null, null)).toBe(0);
    expect(generationStepIndex(ko, "starting", null)).toBe(0);
    expect(generationStepIndex(ko, "running", null)).toBe(0);
  });

  it.each([
    ["brief", 0],
    ["imagery", 1],
    ["render", 2],
    ["checks", 3],
  ] as const)("KO path: %s is step %i", (stage, index) => {
    expect(generationStepIndex(ko, "running", stage)).toBe(index);
  });

  it.each([
    ["brief", 0],
    ["render", 1],
    ["checks", 2],
  ] as const)("upload path: %s is step %i", (stage, index) => {
    expect(generationStepIndex(upload, "running", stage)).toBe(index);
  });

  /* Never reported on the upload path, but if it were, the list must not
     jump back to the brief. */
  it("puts a stage the list has no step for on the next step", () => {
    expect(generationStepIndex(upload, "running", "imagery")).toBe(1);
  });

  it("is on the last step while the finished job's rows are read", () => {
    expect(generationStepIndex(ko, "fetching", "checks")).toBe(3);
    expect(generationStepIndex(upload, "fetching", null)).toBe(2);
  });
});

describe("isUnusableImageError", () => {
  /* The real server and browser messages, not a hand-written copy of them:
     an earlier matcher passed its own full-stop fixture and missed the colon
     the server actually sends. */
  it("matches the server loader's message", () => {
    const message = new DesignImageError("unreadable").message;
    expect(message).toMatch(/^This image can't be used: /);
    expect(isUnusableImageError(message)).toBe(true);
  });

  it("matches the browser normaliser's message", () => {
    expect(
      isUnusableImageError(new ImageNotUsableError("too_large").message),
    ).toBe(true);
  });

  it("matches with a typographic apostrophe", () => {
    expect(
      isUnusableImageError("This image can’t be used: it is damaged."),
    ).toBe(true);
  });

  it("does not match other failures", () => {
    expect(isUnusableImageError("Design generation failed.")).toBe(false);
    expect(isUnusableImageError("We think this image can't be used")).toBe(
      false,
    );
    expect(isUnusableImageError(null)).toBe(false);
  });
});

describe("unusableImageReason", () => {
  it("strips the prefix and its colon from the real server message", () => {
    expect(
      unusableImageReason(new DesignImageError("too_many_pixels").message),
    ).toBe(
      `It is larger than ${MAX_DESIGN_IMAGE_SIDE} px on one side. Choose a smaller image.`,
    );
  });

  it("strips the full-stop form too", () => {
    expect(
      unusableImageReason("This image can't be used. Choose a PNG or JPG."),
    ).toBe("Choose a PNG or JPG.");
  });

  it("is empty when nothing follows the prefix", () => {
    expect(unusableImageReason("This image can't be used.")).toBe("");
  });

  it("leaves any other message alone", () => {
    expect(unusableImageReason("Design generation failed.")).toBe(
      "Design generation failed.",
    );
  });
});

describe("unusableImageDetail", () => {
  /* Round 2 read "...may be damaged. Choose another image." over a "Choose
     another image" button: the instruction the button already gives. */
  it.each([
    [
      new DesignImageError("unreadable").message,
      "It could not be read and may be damaged.",
    ],
    [
      new DesignImageError("not_png_or_jpeg").message,
      "It is not a PNG or JPEG file.",
    ],
    [
      new DesignImageError("foreign_key").message,
      "It was not uploaded for this brand.",
    ],
    [
      new ImageNotUsableError("undecodable").message,
      "It couldn't be opened and may be damaged.",
    ],
    [
      new ImageNotUsableError("wrong_type").message,
      "It is not a PNG, JPEG or WEBP file.",
    ],
  ])("drops the remedy the button repeats from %s", (message, expected) => {
    expect(unusableImageDetail(message)).toBe(expected);
  });

  it("keeps a remedy the button does not say", () => {
    expect(unusableImageDetail(new DesignImageError("too_large").message)).toBe(
      `It is larger than ${MAX_DESIGN_IMAGE_BYTES / (1024 * 1024)} MB. Choose a smaller image.`,
    );
    expect(unusableImageDetail(new DesignImageError("missing").message)).toBe(
      "The upload could not be found. Upload it again.",
    );
    expect(
      unusableImageDetail(new ImageNotUsableError("encode_failed").message),
    ).toBe(
      "It couldn't be prepared for upload. Try again or choose another image.",
    );
  });

  it("is empty when the remedy was all there was", () => {
    expect(
      unusableImageDetail("This image can't be used: Choose another image."),
    ).toBe("");
  });
});

describe("startOverLabel", () => {
  it("offers to change the image only when one was chosen", () => {
    expect(startOverLabel("upload")).toBe("Change image");
    expect(startOverLabel("ko")).toBe("Start over");
    expect(startOverLabel("none")).toBe("Start over");
    expect(startOverLabel(null)).toBe("Start over");
  });
});

describe("resultsHeading", () => {
  it("promises two directions only when both are on screen", () => {
    expect(resultsHeading(2, 2).title).toBe("Two directions to choose from");
    expect(resultsHeading(1, 2)).toEqual({
      title: "One direction is ready",
      description:
        "The other didn't render. Use the one that's ready, or regenerate the other for a fresh take.",
    });
  });

  it("never claims a direction is ready when none is", () => {
    expect(resultsHeading(0, 2)).toEqual({
      title: "Neither direction rendered",
      description: "Regenerate either one to try again.",
    });
    expect(resultsHeading(0, 1).description).toBe(
      "Regenerate it to try again.",
    );
  });

  it("covers a single slot and an empty run", () => {
    expect(resultsHeading(1, 1).title).toBe("Your direction is ready");
    expect(resultsHeading(0, 0).title).toBe("Your designs");
  });

  it("counts past the words it knows", () => {
    expect(resultsHeading(2, 5).title).toBe("Two directions are ready");
    expect(resultsHeading(2, 5).description).toMatch(/^Three didn't render/);
    expect(resultsHeading(7, 7).title).toBe("7 directions to choose from");
  });
});
