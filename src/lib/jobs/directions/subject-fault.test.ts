// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  SUBJECT_COVERED,
  SUBJECT_CROPPED,
} from "@/lib/design/document/subject";

/* A build that reports only "cropped" while its headline sits on the
   subject: what the round-3 eval caught on the conference case. */
vi.mock("@/lib/design/document/from-spec", () => ({
  documentFromSpec: async () => ({
    copyFault: null,
    subjectFault: SUBJECT_CROPPED,
    document: {
      version: 1,
      width: 1000,
      height: 1000,
      background: "#ffffff",
      elements: [
        {
          id: "image",
          type: "image",
          x: 0,
          y: 0,
          width: 1000,
          height: 1000,
          fit: "cover",
          crop: { zoom: 1, focusX: 0.5, focusY: 0.5 },
          asset: { key: "design-images/x/y.png" },
        },
        {
          id: "headline",
          type: "text",
          role: "headline",
          x: 400,
          y: 450,
          width: 300,
          height: 80,
        },
      ],
    },
  }),
}));
vi.mock("@/lib/design/document/measure", () => ({
  createRendererMeasurer: () => ({}),
}));

const { subjectFaultChecker } = await import("./render");
const { draftOf, directionsContext } = await import("./fixtures");

describe("subjectFaultChecker", () => {
  it("calls copy on the subject covered, whatever the builder reported", async () => {
    const check = subjectFaultChecker(
      directionsContext() as never,
      {
        image: {
          ref: { key: "design-images/x/y.png" },
          asset: { bytes: new Uint8Array(), contentType: "image/png" },
        },
        imageFacts: {
          width: 1000,
          height: 1000,
          cutout: false,
          ink: { left: 0, top: 0, right: 1, bottom: 1 },
          grid: { cols: 1, rows: 1, rgba: [0, 0, 0, 255] },
        },
        logo: null,
      },
      { fonts: [] },
    );
    expect(
      await check(draftOf() as never, { x: 0.35, y: 0.35, w: 0.3, h: 0.3 }),
    ).toBe(SUBJECT_COVERED);
    expect(
      await check(draftOf() as never, { x: 0, y: 0, w: 0.2, h: 0.2 }),
    ).toBe(SUBJECT_CROPPED);
  });
});
