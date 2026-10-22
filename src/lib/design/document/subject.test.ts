import { describe, expect, it } from "vitest";
import type { ImageFacts, Rect } from "./builders/ground";
import type { DesignDocument, DesignElement } from "./schema";
import {
  coverPlacement,
  isSubjectBox,
  MIN_SUBJECT_SIDE,
  measureSubject,
  resolveSubject,
  SUBJECT_BOX_INVALID,
  SUBJECT_GAP,
  SUBJECT_MIN_SHARE,
  SubjectBoxFault,
  subjectFromAlpha,
  subjectOnCanvas,
} from "./subject";

const IMAGE = { width: 3000, height: 2000 };
const CENTRE = { x: 0.4, y: 0.35, w: 0.2, h: 0.3 };
const FRAME: Rect = { x: 0, y: 0, width: 1080, height: 1350 };

describe("isSubjectBox", () => {
  it.each([
    [CENTRE, true],
    [{ x: 0, y: 0, w: 1, h: 1 }, true],
    [{ x: 0.5, y: 0.5, w: 0.6, h: 0.1 }, false],
    [{ x: -0.1, y: 0, w: 0.5, h: 0.5 }, false],
    [{ x: 0, y: 0, w: 0, h: 0.5 }, false],
    [{ x: 0, y: 0, w: Number.NaN, h: 0.5 }, false],
    [{ x: "0", y: 0, w: 0.5, h: 0.5 }, false],
    [null, false],
    /* Round 3 clamped or dropped these without a word. */
    [{ x: 0.3, y: 0.35, w: 0.72, h: 0.5 }, false],
    [{ x: -0.01, y: 0.35, w: 0.5, h: 0.5 }, false],
    [{ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, false],
    [{ x: 0.5, y: 0.5, w: 1e-9, h: 1e-9 }, false],
    [{ x: 0.5, y: 0.5, w: MIN_SUBJECT_SIDE, h: MIN_SUBJECT_SIDE }, true],
  ])("%j is %s", (box, valid) => {
    expect(isSubjectBox(box)).toBe(valid);
  });
});

describe("resolveSubject", () => {
  const cutout = (ink: ImageFacts["ink"]): ImageFacts => ({
    width: 400,
    height: 400,
    cutout: true,
    ink,
    grid: { cols: 1, rows: 1, rgba: [0, 0, 0, 0] },
  });
  const photo = { ...cutout({ left: 0, top: 0, right: 1, bottom: 1 }) };
  photo.cutout = false;

  it("keeps a valid box as given, never clamped", () => {
    expect(resolveSubject(CENTRE, photo)).toEqual(CENTRE);
  });

  it.each([
    { x: 0.3, y: 0.35, w: 0.72, h: 0.5 },
    { x: -0.01, y: 0.35, w: 0.5, h: 0.5 },
    { x: Number.NaN, y: 0.3, w: 0.3, h: 0.3 },
    { x: 0.5, y: 0.5, w: 0, h: 0.3 },
    { x: 0.999, y: 0.999, w: 0.001, h: 0.001 },
  ])("refuses %j with a typed fault", (box) => {
    const attempt = () => resolveSubject(box, photo);
    expect(attempt).toThrow(SubjectBoxFault);
    try {
      attempt();
    } catch (error) {
      expect((error as SubjectBoxFault).code).toBe(SUBJECT_BOX_INVALID);
      expect((error as SubjectBoxFault).source).toBe("given");
    }
  });

  it("reads a cut-out's box from alpha, and refuses one with nothing visible", () => {
    const ink = { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 };
    expect(resolveSubject(null, cutout(ink))).toEqual({
      x: 0.25,
      y: 0.25,
      w: 0.5,
      h: 0.5,
    });
    expect(() =>
      resolveSubject(null, cutout({ left: 0, top: 0, right: 0, bottom: 0 })),
    ).toThrow(/too small to place/);
  });

  it("lays out a photograph without a box as having no subject", () => {
    expect(resolveSubject(undefined, photo)).toBeNull();
    expect(resolveSubject(null, null)).toBeNull();
  });
});

it("reads a cut-out's subject from its visible pixels", () => {
  const facts = {
    width: 400,
    height: 400,
    cutout: true,
    ink: { left: 0.25, top: 0.25, right: 0.75, bottom: 0.75 },
    grid: { cols: 1, rows: 1, rgba: [0, 0, 0, 0] },
  } satisfies ImageFacts;
  expect(subjectFromAlpha(facts)).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
});

describe("coverPlacement", () => {
  const minEdge = Math.ceil(1080 * SUBJECT_MIN_SHARE);

  it("shows the subject whole, large enough and clear of every keep-out", () => {
    const copy: Rect = { x: 86, y: 800, width: 908, height: 400 };
    const placement = coverPlacement(IMAGE, CENTRE, FRAME, [copy], minEdge);
    expect(placement).not.toBeNull();
    const box = subjectOnCanvas(
      IMAGE,
      CENTRE,
      placement as NonNullable<typeof placement>,
    );
    expect(box.y + box.height).toBeLessThanOrEqual(copy.y);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(FRAME.width + 0.5);
    expect(Math.max(box.width, box.height)).toBeGreaterThanOrEqual(minEdge);
  });

  it("takes the least zoom that works", () => {
    const placement = coverPlacement(IMAGE, CENTRE, FRAME, [], 0);
    expect(placement?.zoom).toBe(1);
  });

  it("is null when the subject cannot clear the copy at any zoom", () => {
    const everywhere: Rect = { x: 0, y: 0, width: 1080, height: 1350 };
    expect(
      coverPlacement(IMAGE, CENTRE, FRAME, [everywhere], minEdge),
    ).toBeNull();
  });
});

describe("measureSubject", () => {
  const base = {
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
  };
  const image: DesignElement = {
    ...base,
    id: "image",
    name: "Image",
    type: "image",
    x: 0,
    y: 0,
    width: 1080,
    height: 1350,
    asset: { key: "design-images/b1/photo.jpg" },
    fit: "cover",
    crop: { zoom: 1, focusX: 0.5, focusY: 0.5 },
    radius: 0,
  };
  const shape = (id: string, box: Rect): DesignElement => ({
    ...base,
    ...box,
    id,
    name: id,
    type: "shape",
    fill: "#C2410C",
    borderColor: "transparent",
    borderWidth: 0,
    radius: 0,
  });
  const docWith = (...elements: DesignElement[]): DesignDocument => ({
    version: 1,
    width: 1080,
    height: 1350,
    background: "#FFFFFF",
    elements: [image, ...elements],
  });
  const subjectBox = subjectOnCanvas(IMAGE, CENTRE, {
    frame: FRAME,
    fit: "cover",
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
  });

  it("passes a subject nothing sits on", () => {
    const report = measureSubject(docWith(), IMAGE, CENTRE);
    expect(report?.ok).toBe(true);
    expect(report?.overlaps).toEqual([]);
    expect(report?.visibleShare).toBeCloseTo(1);
  });

  it("names a decoration laid on the subject, such as the accent rule", () => {
    const rule = shape("accent-rule", {
      x: subjectBox.x + 10,
      y: subjectBox.y + subjectBox.height / 2,
      width: 97,
      height: 9,
    });
    const report = measureSubject(docWith(rule), IMAGE, CENTRE);
    expect(report?.ok).toBe(false);
    expect(report?.overlaps.map((o) => o.id)).toEqual(["accent-rule"]);
  });

  /* Round-3 eval: a photo framed in half the canvas cropped its large
     subject, and the hidden part of the box "overlapped" the copy beside
     the frame, so every layout looked covered. */
  it("counts only the drawn part of a cropped subject as coverable", () => {
    const halfImage = { ...image, width: 540 };
    const wide = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 };
    const copy = shape("cta", { x: 600, y: 600, width: 300, height: 80 });
    const doc: DesignDocument = {
      ...docWith(copy),
      elements: [halfImage, copy],
    };
    const report = measureSubject(doc, IMAGE, wide);
    expect(report?.visibleShare).toBeLessThan(0.995);
    expect(report?.overlaps).toEqual([]);
  });

  it("counts the clear space around the subject as part of it", () => {
    const gap = 1080 * SUBJECT_GAP;
    const near = shape("accent-rule", {
      x: subjectBox.x,
      y: subjectBox.y + subjectBox.height + gap / 2,
      width: 97,
      height: 9,
    });
    const clear = shape("accent-rule", {
      x: subjectBox.x,
      y: subjectBox.y + subjectBox.height + gap + 1,
      width: 97,
      height: 9,
    });
    expect(measureSubject(docWith(near), IMAGE, CENTRE)?.ok).toBe(false);
    expect(measureSubject(docWith(clear), IMAGE, CENTRE)?.ok).toBe(true);
  });

  it("lets ground the subject is drawn on sit under it: scrims, cards, the footer bar", () => {
    const scrim = shape("scrim", FRAME);
    const card = shape("card", FRAME);
    const big = shape("panel", { x: 0, y: 0, width: 1080, height: 700 });
    expect(measureSubject(docWith(scrim, card, big), IMAGE, CENTRE)?.ok).toBe(
      true,
    );
  });

  it("fails a subject drawn below its minimum share, and one cut by its frame", () => {
    const thumbnail = measureSubject(docWith(), IMAGE, {
      x: 0.45,
      y: 0.45,
      w: 0.05,
      h: 0.05,
    });
    expect(thumbnail?.edgeShare).toBeLessThan(SUBJECT_MIN_SHARE);
    expect(thumbnail?.ok).toBe(false);
    const cut = measureSubject(docWith(), IMAGE, {
      x: 0,
      y: 0.3,
      w: 0.3,
      h: 0.3,
    });
    expect(cut?.visibleShare).toBeLessThan(1);
    expect(cut?.ok).toBe(false);
  });

  it("is null when the document draws no image", () => {
    const doc = { ...docWith(), elements: [] };
    expect(measureSubject(doc, IMAGE, CENTRE)).toBeNull();
  });
});
