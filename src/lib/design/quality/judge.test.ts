import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { allowedCornersFor } from "@/lib/design/logo-placement";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";

const generateObject = vi.fn();
vi.mock("ai", () => ({ generateObject: (a: unknown) => generateObject(a) }));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));

import type { DesignFault } from "./checks";
import {
  applyPrescribedChange,
  CORRECTABLE_FIELDS,
  type CorrectableField,
  correctableFieldsFor,
  correctionSummary,
  DIAGNOSTIC_SYMPTOMS,
  type DiagnosticSymptom,
  JUDGE_MAX_OUTPUT_TOKENS,
  judgeAndCorrect,
  prescribableFields,
  RUBRIC_CATEGORIES,
  RUBRIC_CRITERIA,
  type RubricScores,
  requiresRevision,
  SYMPTOM_CORRECTIONS,
  symptomsFor,
  weakestCategory,
} from "./judge";

beforeEach(() => {
  /* The fail-soft paths log on purpose. Printing them turns a green suite into
     a wall of "design judge unavailable". */
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/* KOOS-AI-001 AC-3, with Oluwaseyi's decision: the rubric judge runs ONLY
   after the deterministic checks in checks.ts have already failed, and makes
   exactly one correction pass. Before this, renderGuarded re-rendered the
   IDENTICAL spec — a dice re-roll, not a correction.

   The failure this suite is written to make impossible is the bodyPoints one:
   a prescription the pipeline silently discards. Every accepted change has to
   survive designSpecSchema AND reach a field render/layouts.tsx actually
   draws, on the route that is re-rendering. */

const BASE: DesignSpec = designSpecSchema.parse({
  layout: "hero-center",
  headline: "Doors open at seven",
  subheadline: "An evening of highlife and small chops in Yaba",
  cta: "Reserve a seat",
  footerStyle: "text",
  footerLines: ["0800 000 0000", "yaba, lagos"],
  palette: { background: "#102A43", foreground: "#FFFFFF", accent: "#F0B429" },
  logoPlacement: "top-right",
  logoFree: false,
  logoFreeQuote: "",
  backgroundPrompt: "warm Lagos rooftop at dusk, wide open sky",
  backgroundTreatment: "photographic",
  nativePrompt: "A rooftop party poster for a Lagos venue",
  aspectRatio: "1:1",
});

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

const READABLE = png(1080, 1080, 400_000);

const fault = (code: DesignFault["code"]): DesignFault => ({
  code,
  detail: `the ${code} detail sentence`,
});

const scores = (overrides: Partial<RubricScores> = {}): RubricScores => ({
  briefAccuracy: 4,
  messageClarity: 4,
  hierarchy: 4,
  brandRecognition: 4,
  typography: 4,
  imagery: 4,
  integration: 4,
  spacing: 4,
  ctaFooter: 4,
  freshness: 4,
  ...overrides,
});

function answer(
  change: { field: CorrectableField; value: string },
  overrides: {
    scores?: Partial<RubricScores>;
    symptom?: DiagnosticSymptom;
    reason?: string;
  } = {},
) {
  return {
    object: {
      scores: scores(overrides.scores),
      symptom: overrides.symptom ?? "off-brand",
      change,
      reason: overrides.reason ?? "the accent no longer reads as this brand",
    },
  };
}

/* Colours the fixture spec does NOT carry, on purpose. buildJudgeUserPrompt
   dumps every drawn field including the palette, so a brand sharing the spec's
   hexes satisfies "tells the judge the brand's colours" from the spec dump —
   and the assertion stays green with brandPalette() deleted from the system
   prompt. It is also the realistic case: the art director's palette is a
   reading of the brand's, not a copy of it. */
const BRAND = {
  name: "Kọ",
  primaryColor: "#1B4332",
  secondaryColor: "#D64545",
  tone: "warm",
};

const judgeArgs = (over: Partial<Parameters<typeof judgeAndCorrect>[0]> = {}) =>
  ({
    spec: BASE,
    renderer: "composite" as const,
    faults: [fault("unreadable-logo")],
    image: READABLE,
    brief: "A rooftop party in Yaba. Doors at seven.",
    brand: BRAND,
    hasLogo: true,
    ...over,
  }) satisfies Parameters<typeof judgeAndCorrect>[0];

const systemSentToModel = (): string => generateObject.mock.calls[0][0].system;

const userTextSentToModel = (): string =>
  generateObject.mock.calls[0][0].messages[0].content.find(
    (part: { type: string }) => part.type === "text",
  ).text;

const promptSentToModel = () =>
  `${systemSentToModel()}\n\n${userTextSentToModel()}`;

/** The field guide's own line for one lever, as the prompt states it. */
const fieldGuideLine = (field: CorrectableField): string => {
  const line = systemSentToModel()
    .split("\n")
    .find((row) => row.startsWith(`- "${field}":`));
  if (!line) throw new Error(`no field-guide line for ${field}`);
  return line;
};

describe("module 06 §10 rubric", () => {
  it("scores the ten categories the manual names", () => {
    expect([...RUBRIC_CATEGORIES]).toEqual([
      "briefAccuracy",
      "messageClarity",
      "hierarchy",
      "brandRecognition",
      "typography",
      "imagery",
      "integration",
      "spacing",
      "ctaFooter",
      "freshness",
    ]);
  });

  /* §10 step 9: "Fix the lowest-scoring category first." Computed from the
     scores rather than asked for — the model has no business restating a
     minimum it already gave us, and asking would let it disagree with itself. */
  it("picks the lowest-scoring category", () => {
    expect(weakestCategory(scores({ spacing: 2 }))).toBe("spacing");
    expect(weakestCategory(scores({ hierarchy: 1, spacing: 2 }))).toBe(
      "hierarchy",
    );
  });

  /* Ties resolve in the manual's own order, which puts brief accuracy first
     and freshness last. That ranking is the manual's judgement about what
     matters, so a tie is not a coin toss. */
  it("breaks ties in the manual's order of importance", () => {
    expect(weakestCategory(scores({ freshness: 2, briefAccuracy: 2 }))).toBe(
      "briefAccuracy",
    );
  });

  /* §10: "A serious failure in brief accuracy, brand recognition, or
     readability requires revision regardless of the total score." */
  it("requires revision on a serious failure even when the total is high", () => {
    expect(requiresRevision(scores({ briefAccuracy: 2 }))).toBe(true);
    expect(requiresRevision(scores({ brandRecognition: 1 }))).toBe(true);
    expect(requiresRevision(scores({ typography: 2 }))).toBe(true);
  });

  it("does not require revision for a weak but non-critical category", () => {
    expect(requiresRevision(scores({ freshness: 1, imagery: 1 }))).toBe(false);
  });
});

describe("module 06 §11 correction map", () => {
  it("covers every symptom the manual lists", () => {
    expect(Object.keys(SYMPTOM_CORRECTIONS).sort()).toEqual([
      "artificial",
      "crowded",
      "empty",
      "flat",
      "generic",
      "off-brand",
      "pasted-footer",
      "repetitive",
      "weak-cta",
    ]);
  });

  /* The bodyPoints guard, at the map level: §11 may only ever point at a
     field the spec declares. A symptom whose correction names something the
     schema does not carry is an instruction the renderer would discard. */
  it("prescribes only fields designSpecSchema declares", () => {
    const declared = new Set(Object.keys(designSpecSchema.shape));
    for (const field of CORRECTABLE_FIELDS) {
      expect(declared).toContain(field.split(".")[0]);
    }
  });

  it("maps every symptom onto correctable fields only", () => {
    for (const fields of Object.values(SYMPTOM_CORRECTIONS)) {
      for (const field of fields) {
        expect(CORRECTABLE_FIELDS).toContain(field);
      }
    }
  });
});

/* The bodyPoints failure, mechanized. The schema check above is necessary and
   nowhere near sufficient: `bodyPoints` was declared by designSpecSchema and
   would have passed it. The only guard that catches a field nothing draws is
   reading the drawing code and looking for the field in it. Add a correctable
   field no renderer reads and this suite goes red without anyone remembering
   to check. */
describe("every correctable field is one the renderer actually draws", () => {
  const read = (path: string) =>
    readFileSync(join(process.cwd(), "src", path), "utf8");

  /** The named function's body, so a field proved by the plate prompt cannot
   *  be proved by the native prompt sitting in the same file. */
  function functionBody(source: string, name: string): string {
    const start = source.indexOf(`export function ${name}(`);
    expect(start, `${name} not found`).toBeGreaterThan(-1);
    const end = source.indexOf("\n}", start);
    return source.slice(start, end);
  }

  const prompts = read("lib/ai/prompts/design-spec.ts");
  const SOURCES = {
    layouts: read("lib/design/render/layouts.tsx"),
    footer: read("lib/design/render/footer.ts"),
    composite: read("lib/design/render/composite.ts"),
    plate: functionBody(prompts, "buildBackgroundPlatePrompt"),
    native: functionBody(prompts, "buildNativePrompt"),
  };

  type Proof = readonly [keyof typeof SOURCES, string];

  /* A palette slot reaches the canvas in two hops: composite.ts hands
     `spec.palette` to resolvePalette and layouts.tsx draws the resolved slot.
     Both hops are asserted, so dropping either one fails. */
  const COMPOSITE_PROOF: Record<CorrectableField, readonly Proof[]> = {
    headline: [["layouts", "spec.headline"]],
    subheadline: [["layouts", "spec.subheadline"]],
    cta: [["layouts", "spec.cta"]],
    layout: [["layouts", "spec.layout"]],
    footerStyle: [
      ["layouts", "spec.footerStyle"],
      ["footer", "spec.footerStyle"],
    ],
    footerLines: [["footer", "spec.footerLines"]],
    logoPlacement: [
      ["composite", "spec.logoPlacement"],
      ["plate", "spec.logoPlacement"],
    ],
    "palette.background": [
      ["composite", "spec.palette"],
      ["layouts", "palette.background"],
    ],
    "palette.accent": [
      ["composite", "spec.palette"],
      ["layouts", "palette.accent"],
    ],
    backgroundPrompt: [["plate", "spec.backgroundPrompt"]],
    backgroundTreatment: [["plate", "spec.backgroundTreatment"]],
    nativePrompt: [],
  };

  const NATIVE_PROOF: Record<string, string> = {
    headline: "spec.headline",
    subheadline: "spec.subheadline",
    cta: "spec.cta",
    logoPlacement: "spec.logoPlacement",
    "palette.background": "spec.palette.background",
    "palette.accent": "spec.palette.accent",
    nativePrompt: "spec.nativePrompt",
  };

  it.each(correctableFieldsFor("composite"))(
    "the composite route draws %s",
    (field) => {
      const proofs = COMPOSITE_PROOF[field];
      expect(proofs.length, `no proof source for ${field}`).toBeGreaterThan(0);
      for (const [source, token] of proofs) {
        expect(SOURCES[source], `${field} in ${source}`).toContain(token);
      }
    },
  );

  it.each(correctableFieldsFor("native"))(
    "the native prompt carries %s",
    (field) => {
      const token = NATIVE_PROOF[field];
      expect(token, `no proof token for ${field}`).toBeTruthy();
      expect(SOURCES.native).toContain(token);
    },
  );

  /* The inverse, and the one that bites: the composite route never reads
     nativePrompt, and the native prompt never reads the plate scene, the
     footer or the layout family. Offering either would be a prescription the
     renderer discards — bodyPoints with a new field name. */
  it("keeps each route's blind fields out of its own list and its own prompt", () => {
    expect(correctableFieldsFor("composite")).not.toContain("nativePrompt");
    expect(SOURCES.plate).not.toContain("spec.nativePrompt");

    for (const blind of [
      "backgroundPrompt",
      "backgroundTreatment",
      "footerStyle",
      "footerLines",
      "layout",
    ] as const) {
      expect(correctableFieldsFor("native")).not.toContain(blind);
      expect(SOURCES.native, blind).not.toContain(`spec.${blind}`);
    }
  });

  /* palette.foreground is excluded on purpose: ensureReadablePair replaces it
     when it misses 4.5:1 and layoutElement forces copy to white over a plate,
     so a prescription on it lands only sometimes. */
  it("offers no field outside the declared correctable set", () => {
    for (const renderer of ["composite", "native"] as const) {
      for (const field of correctableFieldsFor(renderer)) {
        expect(CORRECTABLE_FIELDS).toContain(field);
      }
    }
    expect(CORRECTABLE_FIELDS).not.toContain("palette.foreground");
  });
});

/* The two render routes read DIFFERENT halves of the spec. The composite
   renderer draws layout, footer and the background plate; the native route
   sends nativePrompt and never reads any of them (buildNativePrompt in
   ai/prompts/design-spec.ts). Offering a route a field it ignores is the
   bodyPoints failure with a new field name. */
describe("correctableFieldsFor", () => {
  it("offers the composite route the fields its layouts draw", () => {
    expect([...correctableFieldsFor("composite")].sort()).toEqual([
      "backgroundPrompt",
      "backgroundTreatment",
      "cta",
      "footerLines",
      "footerStyle",
      "headline",
      "layout",
      "logoPlacement",
      "palette.accent",
      "palette.background",
      "subheadline",
    ]);
  });

  it("offers the native route only what its prompt carries", () => {
    expect([...correctableFieldsFor("native")].sort()).toEqual([
      "cta",
      "headline",
      "logoPlacement",
      "nativePrompt",
      "palette.accent",
      "palette.background",
      "subheadline",
    ]);
  });

  it("never offers a route the other route's prompt field", () => {
    expect(correctableFieldsFor("composite")).not.toContain("nativePrompt");
    expect(correctableFieldsFor("native")).not.toContain("backgroundPrompt");
  });

  /* With no logo file there is no mark to composite, so a corner prescription
     spends the one correction pass asking the plate model to keep a corner
     calm for something that will never be stamped. */
  it("drops the logo corner when the brand has no logo", () => {
    for (const renderer of ["composite", "native"] as const) {
      expect(correctableFieldsFor(renderer, false)).not.toContain(
        "logoPlacement",
      );
      expect(correctableFieldsFor(renderer, true)).toContain("logoPlacement");
    }
  });

  it("still leaves every symptom a lever when there is no logo", () => {
    for (const symptom of symptomsFor("composite", false)) {
      expect(
        prescribableFields(symptom, "composite", false).length,
        symptom,
      ).toBeGreaterThan(0);
    }
    expect(prescribableFields("off-brand", "native", false)).not.toContain(
      "logoPlacement",
    );
  });
});

describe("prescribableFields", () => {
  it("intersects the symptom's map with the route", () => {
    expect(prescribableFields("repetitive", "native")).toEqual([
      "nativePrompt",
    ]);
    expect(prescribableFields("pasted-footer", "composite")).toEqual([
      "footerStyle",
      "footerLines",
    ]);
  });

  /* The native route draws no footer at all, so "footer feels pasted on" has
     no applicable correction there. It is withheld from the judge rather than
     offered and then rejected — a symptom with nothing behind it would spend
     the one correction pass on nothing. */
  it("withholds a symptom the route cannot act on", () => {
    expect(prescribableFields("pasted-footer", "native")).toEqual([]);
    expect(symptomsFor("native")).not.toContain("pasted-footer");
    expect(symptomsFor("composite")).toContain("pasted-footer");
  });

  /* Iterated over §11's nine symptoms, not over symptomsFor() — that is
     DEFINED as this filter, so asserting it of its own output is true by
     construction and cannot fail however the map is mangled. */
  it("leaves every symptom but the footer one a lever on both routes", () => {
    expect(DIAGNOSTIC_SYMPTOMS).toHaveLength(9);

    for (const symptom of DIAGNOSTIC_SYMPTOMS) {
      expect(
        prescribableFields(symptom, "composite").length,
        `composite/${symptom}`,
      ).toBeGreaterThan(0);

      const native = prescribableFields(symptom, "native").length;
      if (symptom === "pasted-footer") {
        expect(native).toBe(0);
      } else {
        expect(native, `native/${symptom}`).toBeGreaterThan(0);
      }
    }
  });

  /* §11's weak-cta remedy is "separate it from body copy and use a recognised
     action component" — separation and component, not wording. The native
     route draws no layout and no action pill, so the whole-design instruction
     is the only thing on it that draws the action at all. Without nativePrompt
     the symptom reached exactly one lever there, `cta`, which changes only the
     words. Measured: eval:design-judge's weak-cta-native case had a
     nativePrompt prescription discarded for this. */
  it("leaves the weak call to action a real lever on the native route", () => {
    expect(prescribableFields("weak-cta", "native")).toContain("nativePrompt");
    /* And not on the composite route, which has a layout and a pill of its
       own and never reads nativePrompt. */
    expect(prescribableFields("weak-cta", "composite")).not.toContain(
      "nativePrompt",
    );
  });
});

describe("applyPrescribedChange", () => {
  const apply = (
    field: CorrectableField,
    value: string,
    spec: DesignSpec = BASE,
    renderer: "composite" | "native" = "composite",
  ) => applyPrescribedChange(spec, { field, value }, renderer);

  it("returns a spec that differs in the prescribed field", () => {
    const next = apply("headline", "Rooftop, seven sharp");
    expect(next?.headline).toBe("Rooftop, seven sharp");
    expect(next).not.toBe(BASE);
    expect(next?.backgroundPrompt).toBe(BASE.backgroundPrompt);
  });

  /* The whole point of the ticket. A re-render on an unchanged spec is the
     dice re-roll renderGuarded already did. */
  it("rejects a value identical to what is already there", () => {
    expect(apply("headline", BASE.headline)).toBeNull();
    expect(apply("headline", `  ${BASE.headline}  `)).toBeNull();
  });

  it("rejects a value the spec schema refuses", () => {
    expect(apply("headline", "x".repeat(71))).toBeNull();
    expect(apply("headline", "")).toBeNull();
    expect(apply("cta", "x".repeat(33))).toBeNull();
  });

  it("rejects a value that is not one of an enum field's members", () => {
    expect(apply("layout", "collage")).toBeNull();
    expect(apply("backgroundTreatment", "cinematic")).toBeNull();
    expect(apply("footerStyle", "ribbon")).toBeNull();
  });

  /* §11's answer to "looks crowded" is to REDUCE copy, so an empty value has
     to mean "take it off" rather than failing validation. */
  it("takes the subheadline off when the prescription is empty", () => {
    const next = apply("subheadline", "");
    expect(next?.subheadline).toBeUndefined();
  });

  /* And the action is where it stops. §10 scores ctaFooter on "the action is
     visible" and §11's "reduce copy" is the supporting line, so deleting the
     user's call to action is damage, not a quality fix — reachable from
     "crowded", on a design whose only real fault was an empty plate. */
  it("refuses to empty the call to action", () => {
    expect(apply("cta", "")).toBeNull();
    expect(apply("cta", "   ")).toBeNull();
    expect(apply("cta", "Book a table")?.cta).toBe("Book a table");
  });

  it("refuses to empty a field that is already empty", () => {
    const noSub = { ...BASE, subheadline: undefined };
    expect(apply("subheadline", "", noSub)).toBeNull();
  });

  /* treatmentClause (prompts/design-spec.ts) renders "solid" as "Flat solid
     colour field", and checks.ts measures a flat 1024x1024 PNG at 0.003 B/px
     against its BLANK_MAX_BYTES_PER_PIXEL floor of 0.05. Prescribing it buys
     the blank-frame fault this module exists to answer. It stays legal in the
     schema for the art director; it is not a correction. */
  it("refuses a flat solid background treatment", () => {
    expect(apply("backgroundTreatment", "solid")).toBeNull();
    expect(apply("backgroundTreatment", "gradient")?.backgroundTreatment).toBe(
      "gradient",
    );
  });

  /* "none" is the escape hatch that silently deleted the brand's mark
     (KOOS-BUG-022). A critic may move the logo; it may never remove it. */
  it("refuses to remove the logo", () => {
    expect(apply("logoPlacement", "none")).toBeNull();
  });

  /* logo-placement.ts owns which corners a layout leaves free. banner-bottom
     draws left-aligned copy across the lower band, so bottom-left puts the
     mark on the headline. A prescription the pipeline would overrule is not
     a correction. */
  it("refuses a corner the layout does not leave free", () => {
    const banner = { ...BASE, layout: "banner-bottom" as const };
    expect(apply("logoPlacement", "bottom-left", banner)).toBeNull();
    expect(apply("logoPlacement", "top-left", banner)?.logoPlacement).toBe(
      "top-left",
    );
  });

  /* The sibling of the no-op footer guard below, and the one the previous pass
     left unprotected. `allowedCornersFor` says hero-center leaves every corner
     free, so patchFor accepts bottom-right — then keepLogoClearOfCopy re-runs
     resolveLogoPlacement, cornersBlockedByFooter takes both bottom corners
     away from the band BASE already draws, and the mark lands back on
     top-right. The field does not read back as prescribed, so the second
     render would be byte-identical to the first and "corrected" would be a
     lie. This is the primary lever for unreadable-logo, the fault the
     correctable set was widened for, which is why it is refused here rather
     than quietly moved. */
  it("refuses a corner the footer band blocks after re-resolution", () => {
    expect(allowedCornersFor(BASE.layout)).toContain("bottom-right");
    expect(BASE.footerStyle).not.toBe("none");
    expect(BASE.footerLines.length).toBeGreaterThan(0);

    expect(apply("logoPlacement", "bottom-right")).toBeNull();

    /* Same corner, same layout, no band to block it: the refusal above is the
       footer re-resolution and not a blanket ban on bottom corners. */
    const noBand = { ...BASE, footerStyle: "none" as const, footerLines: [] };
    expect(apply("logoPlacement", "bottom-right", noBand)?.logoPlacement).toBe(
      "bottom-right",
    );
  });

  /* A footer band covers the bottom corners. A prescription that turns the
     band on has to move a mark that was sitting under it, or the correction
     for one fault creates another. */
  it("moves the mark off a corner the new footer band would cover", () => {
    const marked = { ...BASE, logoPlacement: "bottom-right" as const };
    const next = apply("footerStyle", "bar", marked);
    expect(next?.footerStyle).toBe("bar");
    expect(next?.logoPlacement).not.toBe("bottom-right");
    expect(next?.logoPlacement).not.toBe("none");
  });

  /* Same coupling through the other field: split-left fills the left half
     with copy, so a mark in a left corner has to move with the layout. */
  it("moves the mark off a corner the new layout fills", () => {
    const marked = { ...BASE, logoPlacement: "bottom-left" as const };
    const next = apply("layout", "split-left", marked);
    expect(next?.layout).toBe("split-left");
    expect(["top-right", "bottom-right"]).toContain(next?.logoPlacement);
  });

  it("leaves a logo-free design logo-free", () => {
    const free = {
      ...BASE,
      logoPlacement: "none" as const,
      logoFree: true,
      logoFreeQuote: "please design this with no logo on it",
    };
    const next = apply("layout", "quote-card", free);
    expect(next?.logoPlacement).toBe("none");
  });

  it("reads footer lines one per line, trimmed", () => {
    const next = apply("footerLines", " 0800 111 2222 \n\n yaba, lagos ");
    expect(next?.footerLines).toEqual(["0800 111 2222", "yaba, lagos"]);
  });

  it("clears the footer lines when the prescription is empty", () => {
    expect(apply("footerLines", "")?.footerLines).toEqual([]);
  });

  it("rejects more footer lines than the band draws", () => {
    expect(apply("footerLines", "one\ntwo\nthree\nfour")).toBeNull();
  });

  it("rejects a footer line longer than the band fits", () => {
    expect(apply("footerLines", "x".repeat(61))).toBeNull();
  });

  /* hasFooter() (render/footer.ts) is false when the style is "none" OR when
     no line carries text, so each of these patches a field and renders
     byte-identically. Reported as a correction it is the dice re-roll wearing
     a verdict, which is the one defect this module exists to remove. */
  it("rejects footer lines the style will not draw", () => {
    const noBand = { ...BASE, footerStyle: "none" as const, footerLines: [] };
    expect(apply("footerLines", "0900 000 0000", noBand)).toBeNull();
  });

  it("rejects a footer style with no lines to draw", () => {
    const noLines = { ...BASE, footerStyle: "text" as const, footerLines: [] };
    expect(apply("footerStyle", "bar", noLines)).toBeNull();
    expect(apply("footerStyle", "none", noLines)).toBeNull();
  });

  it("accepts a footer change that does reach the canvas", () => {
    expect(apply("footerStyle", "bar")?.footerStyle).toBe("bar");
    const noBand = { ...BASE, footerStyle: "none" as const };
    expect(apply("footerStyle", "bar", noBand)?.footerStyle).toBe("bar");
  });

  /* buildBackgroundPlatePrompt feeds this straight to the plate model, and the
     composite renderer draws every word of copy itself. Any lettering in the
     plate collides with the typography on top of it. The vocabulary is
     rejected outright rather than parsed for negation — "never omit the text"
     and "omit the text" differ only in scope, which is not regex-tractable
     (logo-placement.ts records three failed attempts at exactly that). */
  it("rejects a background prompt that reaches for lettering", () => {
    expect(
      apply("backgroundPrompt", "a rooftop with the words KO on it"),
    ).toBeNull();
    expect(
      apply("backgroundPrompt", "neon sign lettering over a bar"),
    ).toBeNull();
    expect(
      apply(
        "backgroundPrompt",
        "a rooftop with the words KO OS in neon lettering",
      ),
    ).toBeNull();
  });

  /* The guard used to refuse the correct answer: the field guide itself tells
     the judge the plate must carry no text, so a prompt that says so was
     rejected for agreeing. An explicit prohibition is stripped before
     matching; the words it forbids have to follow it, which is why the last
     case is still refused. */
  it("accepts a background prompt whose only lettering word is forbidden", () => {
    expect(
      apply("backgroundPrompt", "a deep courtyard, lanterns close, no text")
        ?.backgroundPrompt,
    ).toBe("a deep courtyard, lanterns close, no text");
    expect(
      apply("backgroundPrompt", "no text, just a dusk sky"),
    ).not.toBeNull();
    expect(
      apply("backgroundPrompt", "a dusk sky without words or signage"),
    ).not.toBeNull();
    expect(
      apply("backgroundPrompt", "a courtyard, no visible text or lettering"),
    ).not.toBeNull();
    expect(
      apply("backgroundPrompt", "a rooftop with no clouds and the words KO OS"),
    ).toBeNull();
  });

  it("accepts a background prompt that only describes a scene", () => {
    const next = apply(
      "backgroundPrompt",
      "low evening sun across an empty rooftop, long shadows",
    );
    expect(next?.backgroundPrompt).toBe(
      "low evening sun across an empty rooftop, long shadows",
    );
  });

  /* The native prompt is the opposite — it MUST describe the copy — but the
     real logo file is composited over the model's output, so a prompt that
     asks for a mark produces two (KOOS-BUG-022). */
  it("rejects a native prompt that asks for a logo", () => {
    expect(
      apply(
        "nativePrompt",
        "a poster with the brand logo top right",
        BASE,
        "native",
      ),
    ).toBeNull();
    expect(
      apply(
        "nativePrompt",
        "a poster with the brand logo stamped top right",
        BASE,
        "native",
      ),
    ).toBeNull();
  });

  it("accepts a native prompt that only forbids a logo", () => {
    expect(
      apply(
        "nativePrompt",
        "a rooftop poster, copy centred, no logo anywhere",
        BASE,
        "native",
      )?.nativePrompt,
    ).toBe("a rooftop poster, copy centred, no logo anywhere");
    expect(
      apply(
        "nativePrompt",
        "a rooftop poster with no border and a logo bottom left",
        BASE,
        "native",
      ),
    ).toBeNull();
  });

  it("accepts a native prompt that describes the finished design", () => {
    const next = apply(
      "nativePrompt",
      "A rooftop poster, deep navy ground, copy centred",
      BASE,
      "native",
    );
    expect(next?.nativePrompt).toBe(
      "A rooftop poster, deep navy ground, copy centred",
    );
  });

  /* palette values reach resolvePalette, which drops anything that is not a
     hex and falls back to the brand's own colours — so a colour name is a
     prescription with no effect. */
  it("normalises a prescribed colour and refuses a colour name", () => {
    expect(apply("palette.accent", "#f0b")?.palette.accent).toBe("#FF00BB");
    expect(apply("palette.accent", "burnt sienna")).toBeNull();
  });

  it("leaves the other palette slots alone", () => {
    const next = apply("palette.background", "#1F2933");
    expect(next?.palette).toEqual({
      background: "#1F2933",
      foreground: BASE.palette.foreground,
      accent: BASE.palette.accent,
    });
  });

  it("refuses to move a mark the design will not carry", () => {
    expect(
      applyPrescribedChange(
        BASE,
        { field: "logoPlacement", value: "top-left" },
        "composite",
        false,
      ),
    ).toBeNull();
  });

  it("refuses a field the route does not draw", () => {
    expect(apply("layout", "quote-card", BASE, "native")).toBeNull();
    expect(apply("footerStyle", "bar", BASE, "native")).toBeNull();
    expect(
      apply("backgroundPrompt", "a quiet beach", BASE, "native"),
    ).toBeNull();
    expect(
      apply("nativePrompt", "a poster, centred copy", BASE, "composite"),
    ).toBeNull();
  });
});

describe("judgeAndCorrect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateObject.mockResolvedValue(
      answer({ field: "palette.accent", value: "#E12D39" }),
    );
  });

  /* Oluwaseyi's decision, enforced here rather than trusted to the caller:
     the judge costs nothing when the deterministic checks passed. */
  it("makes no model call when nothing failed", async () => {
    const result = await judgeAndCorrect(judgeArgs({ faults: [] }));

    expect(generateObject).not.toHaveBeenCalled();
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.verdict).toBeNull();
    expect(result.applied).toBeNull();
  });

  it("returns a corrected spec and the verdict", async () => {
    const result = await judgeAndCorrect(judgeArgs());

    expect(result.corrected).toBe(true);
    expect(result.spec.palette.accent).toBe("#E12D39");
    expect(result.verdict?.change).toEqual({
      field: "palette.accent",
      value: "#E12D39",
    });
    expect(result.verdict?.symptom).toBe("off-brand");
    expect(result.verdict?.weakest).toBe("briefAccuracy");
    expect(result.verdict?.seriousFailure).toBe(false);
  });

  /* CLAUDE.md: a change leaves evidence you can point at later. The applied
     value alone is not evidence — there is nothing to compare it to. */
  it("carries both sides of the change it applied", async () => {
    const result = await judgeAndCorrect(judgeArgs());

    expect(result.applied).toEqual({
      field: "palette.accent",
      from: BASE.palette.accent,
      to: "#E12D39",
    });
  });

  it("names the symptom, the total and both sides in one log line", async () => {
    const result = await judgeAndCorrect(judgeArgs());
    const line = correctionSummary(result);

    expect(line).toContain("off-brand");
    expect(line).toContain("40/50");
    expect(line).toContain("palette.accent");
    expect(line).toContain(BASE.palette.accent);
    expect(line).toContain("#E12D39");
    expect(line.split("\n")).toHaveLength(1);
  });

  it("says so in the log line when it refused the prescription", async () => {
    generateObject.mockResolvedValue(
      answer({ field: "headline", value: BASE.headline }),
    );

    const result = await judgeAndCorrect(judgeArgs());
    const line = correctionSummary(result);

    expect(line).toContain("off-brand");
    expect(line).toContain("headline");
    expect(line).toContain("refused");
  });

  it("reports no verdict when the judge was never reached", async () => {
    const result = await judgeAndCorrect(judgeArgs({ faults: [] }));
    expect(correctionSummary(result)).toBe("no verdict");
  });

  /* §10's override travels with the verdict, so the orchestrator can tell a
     design that was merely unremarkable from one that failed on brief
     accuracy, brand recognition or readability. */
  it("carries the serious-failure flag on the verdict", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "palette.accent", value: "#E12D39" },
        { scores: { brandRecognition: 1 } },
      ),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.verdict?.seriousFailure).toBe(true);
    expect(result.verdict?.weakest).toBe("brandRecognition");
  });

  /* §10's override is tripped by brief accuracy, brand recognition or
     readability alone, and the lowest-scoring category is routinely a
     different one — `imagery` in six of nine eval:design-judge runs. The log
     line printed `weakest` beside the word "serious", so it named a category
     that had nothing to do with the override it was explaining. */
  it("names the critical category that caused the serious failure", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "palette.accent", value: "#E12D39" },
        { scores: { typography: 2, imagery: 1 } },
      ),
    );

    const result = await judgeAndCorrect(judgeArgs());
    const line = correctionSummary(result);

    expect(result.verdict?.weakest).toBe("imagery");
    expect(line).toContain("(serious: typography)");
    expect(line).not.toContain("imagery");
  });

  it("names every critical category that failed, not just the first", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "palette.accent", value: "#E12D39" },
        { scores: { briefAccuracy: 1, typography: 2 } },
      ),
    );

    expect(correctionSummary(await judgeAndCorrect(judgeArgs()))).toContain(
      "(serious: briefAccuracy, typography)",
    );
  });

  it("says nothing about a serious failure when none of the three failed", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "palette.accent", value: "#E12D39" },
        { scores: { imagery: 1, spacing: 1 } },
      ),
    );

    expect(correctionSummary(await judgeAndCorrect(judgeArgs()))).not.toContain(
      "serious",
    );
  });

  /* One pass, never a loop: a loop can spin on a brief that cannot be
     satisfied, and every turn costs the user a wait and an image. */
  it("asks once, whatever the answer", async () => {
    await judgeAndCorrect(judgeArgs());
    expect(generateObject).toHaveBeenCalledTimes(1);

    vi.clearAllMocks();
    generateObject.mockResolvedValue(
      answer({ field: "headline", value: BASE.headline }),
    );
    await judgeAndCorrect(judgeArgs());
    expect(generateObject).toHaveBeenCalledTimes(1);
  });

  it("shows the judge the rendered image when the bytes are readable", async () => {
    await judgeAndCorrect(judgeArgs());

    const parts = generateObject.mock.calls[0][0].messages[0].content;
    const image = parts.find((p: { type: string }) => p.type === "image");
    expect(image.image).toBe(READABLE);
    expect(image.mediaType).toBe("image/png");
    expect(generateObject.mock.calls[0][0].messages[0].role).toBe("user");
  });

  it("degrades to spec-only when the bytes are not an image", async () => {
    const result = await judgeAndCorrect(
      judgeArgs({
        faults: [fault("unreadable-image")],
        image: new Uint8Array([1, 2, 3]),
      }),
    );

    const parts = generateObject.mock.calls[0][0].messages[0].content;
    expect(parts.some((p: { type: string }) => p.type === "image")).toBe(false);
    expect(result.verdict?.sawImage).toBe(false);
  });

  /* A flat frame parses as a PNG but has nothing in it to look at, and the
     fault's own sentence already says so. Sending it spends vision tokens on
     an empty rectangle. */
  it("does not send a blank frame it already knows is blank", async () => {
    const result = await judgeAndCorrect(
      judgeArgs({ faults: [fault("blank-frame")] }),
    );

    const parts = generateObject.mock.calls[0][0].messages[0].content;
    expect(parts.some((p: { type: string }) => p.type === "image")).toBe(false);
    expect(result.verdict?.sawImage).toBe(false);
  });

  it("degrades to spec-only when there are no bytes at all", async () => {
    await judgeAndCorrect(judgeArgs({ image: null }));

    const parts = generateObject.mock.calls[0][0].messages[0].content;
    expect(parts.some((p: { type: string }) => p.type === "image")).toBe(false);
  });

  /* The route's field list is what the model is allowed to answer with, so it
     is asserted on the decoding schema rather than on prose in the prompt —
     a prompt sentence can drift out of agreement with the schema, and on
     Bedrock it is the schema that constrains what can be emitted at all. */
  it("constrains the answer to the fields the route draws", async () => {
    await judgeAndCorrect(judgeArgs({ renderer: "native" }));

    const schema = generateObject.mock.calls[0][0].schema;
    expect(schema.shape.change.shape.field.options).toEqual(
      correctableFieldsFor("native"),
    );
    expect(schema.shape.symptom.options).toEqual(symptomsFor("native"));
  });

  /* The guard the model was never shown. `prescribableFields` refuses a field
     outside the named symptom's §11 row, and the prompt listed the symptoms
     and the fields as two separate menus — so a judge could read the design
     correctly, prescribe the right change, and have it discarded for a pairing
     it had no way to see. Measured: two of nine eval:design-judge cases were
     refused for exactly this, one of them prescribing the logo corner for a
     mark genuinely sitting on the headline.

     Generated from the same map the guard reads. A hand-written restatement
     here would pass while the prompt drifted away from the code. */
  it.each([
    ["composite", true],
    ["native", true],
    ["native", false],
  ] as const)(
    "pairs each symptom with the fields it allows (%s, logo %s)",
    async (renderer, hasLogo) => {
      await judgeAndCorrect(judgeArgs({ renderer, hasLogo }));
      const system = systemSentToModel();

      for (const symptom of symptomsFor(renderer, hasLogo)) {
        const allowed = prescribableFields(symptom, renderer, hasLogo)
          .map((field) => `"${field}"`)
          .join(", ");
        expect(system).toContain(
          `- ${symptom} — you may then change ${allowed}`,
        );
      }
    },
  );

  /* And the pairing is restrictive, not a copy of the route's whole menu:
     §11 answers "looks artificial" with light, shadow, perspective and
     texture, none of which is where the mark sits. */
  it("does not offer a symptom a field §11 withholds from it", async () => {
    await judgeAndCorrect(judgeArgs());
    const line = systemSentToModel()
      .split("\n")
      .find((row) => row.startsWith("- artificial — "));

    expect(line).toBeDefined();
    expect(line).not.toContain("logoPlacement");
    expect(correctableFieldsFor("composite")).toContain("logoPlacement");
  });

  it("tells the judge what the deterministic checks found", async () => {
    await judgeAndCorrect(judgeArgs({ faults: [fault("unreadable-logo")] }));

    const call = generateObject.mock.calls[0][0];
    const text = call.messages[0].content.find(
      (p: { type: string }) => p.type === "text",
    ).text;
    expect(text).toContain("the unreadable-logo detail sentence");
  });

  /* brandRecognition is one of §10's three serious categories and the judge
     prescribes hexes, so a prompt that says "the palette comes from these
     colours" and names none of them leaves the model inventing an approved
     colour. */
  it("tells the judge the brand's actual colours", async () => {
    await judgeAndCorrect(judgeArgs());

    expect(systemSentToModel()).toContain(BRAND.primaryColor);
    expect(systemSentToModel()).toContain(BRAND.secondaryColor);

    /* The brand's colours are nowhere in this design's spec, so the per-design
       half of the prompt cannot be what satisfied the two assertions above —
       which is exactly how the previous version of this test passed with the
       feature removed. */
    expect(userTextSentToModel()).not.toContain(BRAND.primaryColor);
    expect(userTextSentToModel()).not.toContain(BRAND.secondaryColor);
  });

  /* A lever the guards refuse is a lever that spends the one correction pass
     on nothing, so the field guide has to stop advertising both of these. */
  it("never offers the judge an empty call to action", async () => {
    await judgeAndCorrect(judgeArgs());

    expect(fieldGuideLine("cta")).not.toMatch(/empty/i);
    expect(fieldGuideLine("subheadline")).toMatch(/empty/i);
  });

  it("never offers the judge the flat solid treatment", async () => {
    await judgeAndCorrect(judgeArgs());

    const [options] = fieldGuideLine("backgroundTreatment").split(". ");
    for (const treatment of [
      "photographic",
      "illustration",
      "gradient",
      "pattern",
    ]) {
      expect(options).toContain(treatment);
    }
    expect(options).not.toContain("solid");
  });

  it("asks for every category in the manual's own words", async () => {
    await judgeAndCorrect(judgeArgs());

    const prompt = promptSentToModel();
    for (const category of RUBRIC_CATEGORIES) {
      expect(prompt).toContain(`${category}: ${RUBRIC_CRITERIA[category]}`);
    }
  });

  /* A calendar brief runs to thousands of words. Sent whole it crowds out the
     rubric the call is paying for. */
  it("sends only the opening of a long brief", async () => {
    const brief = `${"b".repeat(1500)}ONLY-AT-THE-TAIL`;
    await judgeAndCorrect(judgeArgs({ brief }));

    const prompt = promptSentToModel();
    expect(prompt).toContain("b".repeat(1500));
    expect(prompt).not.toContain("ONLY-AT-THE-TAIL");
  });

  it("caps its own output", async () => {
    await judgeAndCorrect(judgeArgs());
    expect(generateObject.mock.calls[0][0].maxOutputTokens).toBe(
      JUDGE_MAX_OUTPUT_TOKENS,
    );
  });

  it("clamps a score outside the manual's 1-5 range", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "palette.accent", value: "#E12D39" },
        { scores: { freshness: 9, spacing: 0, hierarchy: 3.4 } },
      ),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.verdict?.scores.freshness).toBe(5);
    expect(result.verdict?.scores.spacing).toBe(1);
    expect(result.verdict?.scores.hierarchy).toBe(3);
  });

  /* A score that is not a number is not a verdict. Substituting a neutral 3
     would invent the judgement the model failed to give. */
  it("keeps the design when a score is not a number", async () => {
    generateObject.mockResolvedValue({
      object: {
        scores: { ...scores(), spacing: Number.NaN },
        symptom: "off-brand",
        change: { field: "palette.accent", value: "#E12D39" },
        reason: "r",
      },
    });

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.verdict).toBeNull();
  });

  it("keeps the design when the judge throws", async () => {
    generateObject.mockRejectedValue(
      new Error("model does not support images"),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.verdict).toBeNull();
  });

  it("keeps the design when the judge never answers", async () => {
    generateObject.mockImplementation(() => new Promise(() => {}));

    const result = await judgeAndCorrect(judgeArgs({ timeoutMs: 5 }));
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
  });

  /* Asserted by watching it fire, not by its type: a signal built from a
     budget nobody will ever reach is an AbortSignal too. */
  it("passes the provider a signal that aborts on the timeout", async () => {
    await judgeAndCorrect(judgeArgs({ timeoutMs: 120 }));

    const signal: AbortSignal = generateObject.mock.calls[0][0].abortSignal;
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
    await vi.waitFor(() => expect(signal.aborted).toBe(true), {
      timeout: 3000,
      interval: 20,
    });
  });

  /* The unusable-prescription path. The caller is left with exactly the spec
     it had, so it can decide whether a plain re-roll is still worth one try —
     it must never re-render an unchanged spec believing it was corrected. */
  it("keeps the design when the prescription changes nothing", async () => {
    generateObject.mockResolvedValue(
      answer({ field: "headline", value: BASE.headline }),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.applied).toBeNull();
  });

  /* The verdict survives a refusal. "The judge was never reached" and "the
     judge answered and we refused its prescription" are different problems,
     and the second is the signal that tunes the guards — so verdict: null has
     to mean only the first. */
  it("keeps the verdict when it refuses the prescription", async () => {
    generateObject.mockResolvedValue(
      answer({ field: "headline", value: BASE.headline }),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.verdict?.symptom).toBe("off-brand");
    expect(result.verdict?.change).toEqual({
      field: "headline",
      value: BASE.headline,
    });
    expect(result.verdict?.scores.briefAccuracy).toBe(4);
    expect(result.applied).toBeNull();
  });

  it("keeps the design when the prescription does not fit the symptom's map", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "footerLines", value: "0900 000 0000" },
        { symptom: "artificial" },
      ),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.verdict?.symptom).toBe("artificial");
    expect(result.applied).toBeNull();
  });

  it("keeps the design when the judge moves a mark that is not there", async () => {
    generateObject.mockResolvedValue(
      answer({ field: "logoPlacement", value: "top-left" }),
    );

    const result = await judgeAndCorrect(judgeArgs({ hasLogo: false }));
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(
      generateObject.mock.calls[0][0].schema.shape.change.shape.field.options,
    ).not.toContain("logoPlacement");
  });

  /* The byte-identical footer, through the judge rather than through
     applyPrescribedChange: a verdict that reports corrected: true here would
     buy a second render that cannot differ. */
  it("keeps the design when the prescribed footer would draw nothing", async () => {
    generateObject.mockResolvedValue(
      answer(
        { field: "footerLines", value: "0900 000 0000" },
        { symptom: "pasted-footer" },
      ),
    );
    const noBand = { ...BASE, footerStyle: "none" as const, footerLines: [] };

    const result = await judgeAndCorrect(judgeArgs({ spec: noBand }));
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(noBand);
    expect(result.verdict?.symptom).toBe("pasted-footer");
  });

  /* The footer-blocked corner, through the judge rather than through
     applyPrescribedChange. The verdict survives — a refused prescription is
     the signal that tunes the guard — but the spec does not change, because
     resolveLogoPlacement puts the mark straight back where it was. */
  it("keeps the design when the footer blocks the prescribed corner", async () => {
    generateObject.mockResolvedValue(
      answer({ field: "logoPlacement", value: "bottom-right" }),
    );

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.applied).toBeNull();
    expect(result.verdict?.change.value).toBe("bottom-right");
  });

  it("keeps the design when the answer is missing its change", async () => {
    generateObject.mockResolvedValue({ object: { scores: scores() } });

    const result = await judgeAndCorrect(judgeArgs());
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
  });

  /* The outer boundary. visualEvidence sits outside the model call's own
     try/catch and is bounds-checked today, so this reaches it with bytes that
     throw on access — one unguarded parse added later must not be able to
     cost the user a rendered design. */
  it("keeps the design when something outside the model call throws", async () => {
    const hostile = new Proxy(new Uint8Array(8), {
      get() {
        throw new Error("these bytes cannot be touched");
      },
    }) as Uint8Array;

    const result = await judgeAndCorrect(judgeArgs({ image: hostile }));
    expect(result.corrected).toBe(false);
    expect(result.spec).toBe(BASE);
    expect(result.verdict).toBeNull();
    expect(generateObject).not.toHaveBeenCalled();
  });

  /* The corrected spec goes back through the renderer, so it has to be a spec
     — not the original object with a loose field written over it. */
  it("returns a spec the renderer's own schema accepts", async () => {
    const result = await judgeAndCorrect(judgeArgs());
    expect(designSpecSchema.safeParse(result.spec).success).toBe(true);
  });
});
