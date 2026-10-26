import { describe, expect, it } from "vitest";
import {
  aggregateRender,
  craftOfDelivered,
  isCropped,
  majorityJudge,
  RENDER_THRESHOLDS,
  type RenderedCase,
  type RenderedDirection,
  renderFailures,
} from "./render-score";

const direction = (
  over: Partial<RenderedDirection> = {},
): RenderedDirection => ({
  caseId: "c",
  index: 0,
  layout: "hero-center",
  failed: null,
  subjectKnown: true,
  overlaps: 0,
  visibleShare: 1,
  edgeShare: 0.5,
  lookTextOverSubject: false,
  lookSubjectCut: false,
  factsStated: 3,
  factsTotal: 3,
  judgeUnsupported: [],
  judgeMissing: [],
  plateLettering: null,
  ...over,
});

const okCase = (
  directions: RenderedDirection[],
  over: Partial<RenderedCase> = {},
): RenderedCase => ({
  caseId: "c",
  expectRefused: false,
  refused: null,
  directions,
  factsCoveredAnywhere: 3,
  factsTotal: 3,
  ...over,
});

describe("aggregateRender", () => {
  it("passes a clean run", () => {
    const totals = aggregateRender([
      okCase([
        direction({
          correction: {
            prescribed: true,
            kept: false,
            lostFacts: 0,
            overSubject: false,
          },
          copyProbe: {
            lossRefused: true,
            inventionRefused: true,
            rewriteKept: true,
            rewriteOverSubject: false,
          },
        }),
        direction({ index: 1 }),
      ]),
      okCase([], { caseId: "blank", expectRefused: true, refused: "blank" }),
    ]);
    expect(renderFailures(totals)).toEqual([]);
    expect(totals.refusalsMade).toBe(1);
  });

  /* Each of the round-2 live critic's defects fails its own metric. */
  it("fails copy on the subject, a dropped fact, an invented claim, a lettered plate and an accepted blank photo", () => {
    const totals = aggregateRender([
      okCase(
        [
          direction({ overlaps: 2, lookTextOverSubject: true }),
          direction({
            index: 1,
            factsStated: 1,
            judgeUnsupported: ["This weekend only"],
            plateLettering: true,
          }),
        ],
        { factsCoveredAnywhere: 2 },
      ),
      okCase([direction()], { caseId: "blank", expectRefused: true }),
    ]);
    const failures = renderFailures(totals).join("; ");
    for (const name of [
      "copy over subject",
      "look: text over subject",
      "brief facts on any direction",
      "brief facts per direction",
      "judge: invented",
      "lettered plates",
      "bad photos refused",
    ]) {
      expect(failures).toContain(name);
    }
  });

  /* Round-3 critics: a quote card under its footer, a placeholder, a
     product never named, a missing fact only the judge saw, and a
     correction path the eval never ran. */
  it("fails each round-4 defect on its own metric", () => {
    const totals = aggregateRender([
      okCase([
        direction({
          craftHard: "the headline is set smaller than other copy",
          placeholders: ["[REGISTRATION LINK]"],
          productNamed: false,
          judgeMissing: ["ages 16 and up"],
          correction: {
            prescribed: true,
            kept: true,
            lostFacts: 2,
            overSubject: true,
          },
        }),
      ]),
    ]);
    const failures = renderFailures(totals).join("; ");
    for (const name of [
      "craft faults delivered",
      "placeholders",
      "rendered copy names the product",
      "judge: missing",
      "correction lost facts",
      "correction put copy on the subject",
    ]) {
      expect(failures).toContain(name);
    }
    expect(
      renderFailures(aggregateRender([okCase([direction()])])).join(),
    ).toContain("correction paths probed");
  });

  it("counts a refusal of a good photo against the run", () => {
    const totals = aggregateRender([okCase([], { refused: "no_subject" })]);
    expect(renderFailures(totals).join()).toContain("unexpected refusals");
  });

  it("leaves failed directions and unknown subjects out of the shares", () => {
    const totals = aggregateRender([
      okCase([
        direction({ failed: "covered", overlaps: 3 }),
        direction({ index: 1, subjectKnown: false, overlaps: 0 }),
      ]),
    ]);
    expect(totals.failedDirections).toBe(1);
    expect(totals.copyOverSubject).toBe(0);
    expect(totals.subjectKnownShare).toBe(0);
  });
});

describe("isCropped", () => {
  it("is a subject cut by its frame or drawn small", () => {
    expect(isCropped(direction({ visibleShare: 0.9 }))).toBe(true);
    expect(isCropped(direction({ edgeShare: 0.2 }))).toBe(true);
    expect(isCropped(direction())).toBe(false);
    expect(
      isCropped(direction({ subjectKnown: false, visibleShare: 0.1 })),
    ).toBe(false);
  });

  it("holds the thresholds the README states", () => {
    expect(RENDER_THRESHOLDS.maxCopyOverSubject).toBe(0);
    expect(RENDER_THRESHOLDS.minCaseFactCoverage).toBe(1);
  });
});

const at = (
  id: string,
  type: string,
  x: number,
  y: number,
  width: number,
  height: number,
  extra: Record<string, unknown> = {},
) => ({ id, type, x, y, width, height, ...extra }) as never;

describe("craftOfDelivered (round-4 live critic's craft defects)", () => {
  const copy = { headline: "Class in session", footerLines: [] as string[] };

  it("finds an empty image half", () => {
    const empty = craftOfDelivered(
      [at("accent-panel", "shape", 540, 0, 540, 1080)],
      copy,
      "",
    );
    expect(empty.emptyImageRegion).toBe(true);
    const drawn = craftOfDelivered(
      [
        at("accent-panel", "shape", 540, 0, 540, 1080),
        at("image", "image", 560, 40, 500, 1000),
      ],
      copy,
      "",
    );
    expect(drawn.emptyImageRegion).toBe(false);
  });

  it("finds a footer repeating the copy above and the product's name", () => {
    const craft = craftOfDelivered(
      [],
      {
        headline: "Handmade stoneware cups",
        subheadline: "Available from Monday, 7am pickup",
        footerLines: ["Pickup from 7am · Handmade stoneware cups"],
      },
      "stoneware cups",
    );
    expect(craft.footerRepeats).toContain("Pickup from 7am");
    expect(craft.productInFooter).toBe(true);
  });

  it("finds a picture over the stat card's border unless the edge is redrawn", () => {
    const card = at("card", "shape", 86, 86, 908, 1060, { borderWidth: 6 });
    const photo = at("image", "image", 290, 86, 499, 557);
    expect(craftOfDelivered([card, photo], copy, "").imageOverFrame).toBe(true);
    expect(
      craftOfDelivered(
        [card, photo, at("card-edge", "shape", 86, 86, 908, 1060)],
        copy,
        "",
      ).imageOverFrame,
    ).toBe(false);
  });

  it("fails each of them in the totals", () => {
    const totals = aggregateRender([
      okCase([
        direction({
          craft5: {
            emptyImageRegion: true,
            footerRepeats: ["Pickup from 7am"],
            productInFooter: true,
            imageOverFrame: true,
          },
          textLed: true,
          copyProbe: {
            lossRefused: false,
            inventionRefused: true,
            rewriteKept: true,
            rewriteOverSubject: true,
          },
        }),
      ]),
    ]);
    expect(totals.textLed).toBe(1);
    expect(totals.koDirections).toBe(1);
    expect(renderFailures(totals)).toEqual(
      expect.arrayContaining([
        "empty image regions 1.00 > 0",
        "footer repeats 1.00 > 0",
        "product name in footer 1.00 > 0",
        "picture over its frame 1.00 > 0",
        "copy corrections the rules got wrong 1.00 > 0",
        "copy correction put copy on the subject 1.00 > 0",
      ]),
    );
  });
});

describe("majorityJudge", () => {
  const none = { unsupported: [], missing: [], repeated: [], fragments: [] };
  it("counts a flag only when two of three readings agree", () => {
    expect(
      majorityJudge([
        { ...none, unsupported: ["fresh"] },
        none,
        { ...none, unsupported: ["fresh daily"], missing: ["the phone"] },
      ]),
    ).toEqual({ ...none, unsupported: ["fresh"] });
  });

  it("flags nothing on one reading alone, or when two readings failed", () => {
    expect(majorityJudge([{ ...none, missing: ["x"] }, none, none])).toEqual(
      none,
    );
    expect(majorityJudge([{ ...none, repeated: ["x"] }, null, null])).toEqual(
      none,
    );
  });
});
