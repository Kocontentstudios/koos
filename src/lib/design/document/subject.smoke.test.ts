// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { canvasFor } from "@/lib/design/canvas";
import { loadBrandFonts } from "@/lib/design/render/fonts";
import type { ImageFacts } from "./builders/ground";
import {
  LAYOUTS,
  LOGO,
  LOGO_ASPECT,
  PALETTE,
  RATIOS,
  REALISTIC,
  specFor,
  syntheticImages,
  WORST_CASE,
} from "./fixtures";
import { documentFromSpec } from "./from-spec";
import { measureImage } from "./image-facts";
import { createRendererMeasurer, type RendererMeasurer } from "./measure";
import {
  measureSubject,
  SUBJECT_MIN_SHARE,
  type SubjectBox,
  subjectFromAlpha,
} from "./subject";

/**
 * The subject rule on every layout: copy, buttons, the accent rule, the
 * quote mark, the footer and the logo stay off the subject, and the subject
 * is drawn whole at SUBJECT_MIN_SHARE or more, or the build says it could
 * not with a subject fault. Never a silent overlap.
 *
 * Subjects: a cut-out (its alpha bounds) and a photograph with the subject
 * in the middle, low on the left, high on the right, and a large one.
 */

const IMAGES = syntheticImages();
const PHOTO = { key: "design-images/b1/busy.png" };
const CUTOUT = { key: "design-images/b1/cutout.png" };

const PHOTO_SUBJECTS: Record<string, SubjectBox> = {
  centre: { x: 0.35, y: 0.3, w: 0.3, h: 0.4 },
  lowLeft: { x: 0.05, y: 0.55, w: 0.3, h: 0.4 },
  highRight: { x: 0.6, y: 0.05, w: 0.3, h: 0.35 },
  large: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 },
};

let measurer: RendererMeasurer;
let photoFacts: ImageFacts;
let cutoutFacts: ImageFacts;

beforeAll(async () => {
  measurer = createRendererMeasurer({ fonts: await loadBrandFonts(null) });
  const photo = await measureImage(IMAGES.busy);
  const cutout = await measureImage(IMAGES.cutout);
  if (!photo || !cutout) throw new Error("fixtures did not measure");
  photoFacts = photo;
  cutoutFacts = cutout;
});

const COPIES = { realistic: REALISTIC, worst: WORST_CASE };

describe.each(LAYOUTS)("%s", (layout) => {
  it.each(RATIOS)(
    "keeps everything off the subject and the subject large at %s, or says it cannot",
    async (ratio) => {
      const silent: string[] = [];
      const faulted: string[] = [];
      const cases = [
        ...Object.entries(COPIES).map(([copy, text]) => ({
          label: `cutout ${copy}`,
          text,
          image: CUTOUT,
          facts: cutoutFacts,
          subject: null as SubjectBox | null,
        })),
        ...Object.entries(PHOTO_SUBJECTS).map(([where, subject]) => ({
          label: `photo ${where}`,
          text: REALISTIC,
          image: PHOTO,
          facts: photoFacts,
          subject,
        })),
      ];
      for (const { label, text, image, facts, subject } of cases) {
        const build = await documentFromSpec({
          spec: specFor(layout, ratio, text),
          palette: PALETTE,
          canvas: canvasFor(ratio),
          image,
          imageFacts: facts,
          subject,
          logo: { asset: LOGO, aspect: LOGO_ASPECT },
          measurer,
        });
        const report = measureSubject(
          build.document,
          facts,
          subject ?? subjectFromAlpha(facts),
        );
        if (!report) throw new Error(`${label}: no image drawn`);
        if (build.subjectFault) {
          faulted.push(
            `${label}: ${build.subjectFault.slice(0, 40)} edge ${report.edgeShare.toFixed(2)} on it ${report.overlaps.map((o) => o.id).join(",")}`,
          );
          continue;
        }
        if (!report.ok) {
          silent.push(
            `${label}: edge ${report.edgeShare.toFixed(2)} visible ${report.visibleShare.toFixed(3)} on it ${report.overlaps.map((o) => o.id).join(",")}`,
          );
        }
      }
      expect(silent.join("\n"), `${layout} ${ratio}`).toBe("");
      /* The fault is the exception: a cut-out always finds an arrangement,
         and so does a photo whose subject is not most of the frame. */
      expect(
        faulted.filter((label) => !label.startsWith("photo large")).join("\n"),
        `${layout} ${ratio}`,
      ).toBe("");
    },
    300_000,
  );
});

it("states the minimum share it holds", () => {
  expect(SUBJECT_MIN_SHARE).toBeGreaterThanOrEqual(0.35);
});
