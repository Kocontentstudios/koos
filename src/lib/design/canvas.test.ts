import { describe, expect, it } from "vitest";
import { SUPPORTED_ASPECT_RATIOS } from "@/lib/ai/image/types";
import { canvasFor } from "@/lib/design/canvas";

/** What Stability's ~1MP text-to-image returns for each ratio. */
const PLATE = {
  "1:1": { width: 1024, height: 1024 },
  "4:5": { width: 896, height: 1152 },
  "9:16": { width: 768, height: 1344 },
  "16:9": { width: 1344, height: 768 },
} as const;

describe("canvasFor", () => {
  /* Landscape rendered at 1200x675 — SMALLER than the 1344x768 plate — so the
     composite threw away real pixels before anyone could download them. */
  it.each(SUPPORTED_ASPECT_RATIOS)(
    "never renders %s narrower than the plate it composites",
    (ratio) => {
      expect(canvasFor(ratio).width).toBeGreaterThanOrEqual(PLATE[ratio].width);
    },
  );

  /* The plate's own ratio does not always match the requested one (16:9 comes
     back at 7:4), so object-fit: cover crops the difference. Checking width
     alone hid that entirely on the one ratio this changed. */
  it.each(SUPPORTED_ASPECT_RATIOS)(
    "crops no more than 5%% of the %s plate",
    (ratio) => {
      const canvas = canvasFor(ratio);
      const plate = PLATE[ratio];
      /* cover scales by whichever axis needs more, then crops the other — so
         anchoring on width alone reports zero crop for the portrait ratios,
         where the overflow is actually horizontal. */
      const scale = Math.max(
        canvas.width / plate.width,
        canvas.height / plate.height,
      );
      const cropped =
        1 -
        (canvas.width * canvas.height) /
          (plate.width * scale * plate.height * scale);
      expect(cropped).toBeLessThan(0.05);
    },
  );

  it.each(SUPPORTED_ASPECT_RATIOS)("keeps the %s aspect exactly", (ratio) => {
    const [w, h] = ratio.split(":").map(Number);
    const canvas = canvasFor(ratio);
    expect(canvas.width / canvas.height).toBeCloseTo(w / h, 2);
  });

  /* Raising these further only upscales the ~1MP plate: sharper vector text
     bought with a softer background is not a trade to make silently. The
     portrait ratios already sit slightly above the plate and predate this
     work; nothing should move further from it. */
  const UPSCALE_LIMIT: Record<string, number> = {
    "1:1": 1.06,
    "4:5": 1.21,
    "9:16": 1.41,
    // Matches its plate exactly — no invented pixels at all.
    "16:9": 1,
  };

  it.each(SUPPORTED_ASPECT_RATIOS)(
    "does not upscale the %s plate any further",
    (ratio) => {
      expect(canvasFor(ratio).width / PLATE[ratio].width).toBeLessThanOrEqual(
        UPSCALE_LIMIT[ratio],
      );
    },
  );

  it("falls back to square for an unknown ratio", () => {
    expect(canvasFor("21:9" as never)).toEqual(canvasFor("1:1"));
  });
});
