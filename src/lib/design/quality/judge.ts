import { generateObject } from "ai";
import { z } from "zod";
import { anchorsBlock } from "@/lib/ai/design-training/anchors";
import { brandPalette } from "@/lib/ai/prompts/design-spec";
import type { BrandSummary } from "@/lib/ai/prompts/strategy";
import { getModel } from "@/lib/ai/provider";
import {
  allowedCornersFor,
  resolveLogoPlacement,
} from "@/lib/design/logo-placement";
import {
  readJpegDimensions,
  readPngDimensions,
} from "@/lib/design/png-dimensions";
import {
  footerLinesFor,
  hasFooter,
  MAX_FOOTER_LINES,
} from "@/lib/design/render/footer";
import {
  type DesignSpec,
  designSpecSchema,
  LOGO_PLACEMENTS,
} from "@/lib/design/spec";
import { normalizeHex } from "@/lib/validation/hex";
import type { DesignFault } from "./checks";
import { faultSummary } from "./gate";

/**
 * The rubric judge — module 06 §10 and §11 of the AI Design Training System.
 *
 * `renderGuarded` (jobs/run-design-generation.ts) answered a retryable fault by
 * re-rendering the IDENTICAL spec. That is a dice re-roll: the same instruction
 * handed to the same model, with nothing learned from the failure. Module 06's
 * generation loop ends in Evaluate → Correct, and neither step existed anywhere
 * in the codebase.
 *
 * Three decisions shape this module:
 *
 *  1. **Only reachable from a deterministic failure.** Oluwaseyi's call. The
 *     checks in checks.ts are free; this costs a model call and a wait, so a
 *     design that passed them is delivered without ever asking. Enforced here
 *     rather than trusted to the caller: no faults, no call.
 *
 *  2. **One change, applied by code.** The judge names one field and one
 *     value; this module decides whether that prescription survives the
 *     schema, the route and the renderer. A prescription the pipeline would
 *     discard is rejected, because the previous pass shipped a `bodyPoints`
 *     field no layout drew and the model dutifully filled it with the user's
 *     event date (see the comment in design/spec.ts).
 *
 *  3. **Fail soft, always.** Every path out of a failed, slow or nonsensical
 *     judgement returns the spec that came in. The user never loses a design
 *     because the critic was unavailable.
 */

/** §10's ten categories, in the manual's own order — which is also its order
 *  of importance, so a tie for "weakest" is settled rather than tossed. */
export const RUBRIC_CATEGORIES = [
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
] as const;

export type RubricCategory = (typeof RUBRIC_CATEGORIES)[number];

export type RubricScores = Record<RubricCategory, number>;

/** §10's own wording for each category, in one map so the prompt and a future
 *  eval ask for the same thing instead of each restating the manual. */
export const RUBRIC_CRITERIA: Record<RubricCategory, string> = {
  briefAccuracy: "all required information is present and correct",
  messageClarity: "the main idea is understood immediately",
  hierarchy: "the eye follows the intended order",
  brandRecognition: "the design belongs unmistakably to this brand",
  typography: "type is appropriate, readable and well structured",
  imagery: "subject, crop and angle support the message",
  integration: "lighting, shadow, perspective and depth are believable",
  spacing: "neither crowded nor weakly empty",
  ctaFooter: "the action is visible and the utility details are usable",
  freshness: "controlled variation without breaking the brand system",
};

/** §10: "A serious failure in brief accuracy, brand recognition, or
 *  readability requires revision regardless of the total score." Readability
 *  is scored here as typography, which is the category that carries it. */
export const CRITICAL_CATEGORIES: readonly RubricCategory[] = [
  "briefAccuracy",
  "brandRecognition",
  "typography",
];

/** At or below this, a category has failed rather than merely scored low. */
export const SERIOUS_FAILURE_SCORE = 2;

export const MIN_SCORE = 1;
export const MAX_SCORE = 5;

/** §11's nine symptoms, named as the manual names them. */
export const DIAGNOSTIC_SYMPTOMS = [
  "generic",
  "off-brand",
  "repetitive",
  "crowded",
  "empty",
  "flat",
  "artificial",
  "weak-cta",
  "pasted-footer",
] as const;

export type DiagnosticSymptom = (typeof DIAGNOSTIC_SYMPTOMS)[number];

/**
 * Every spec field this module may change.
 *
 * Each one is declared by `designSpecSchema` AND drawn by the renderer — the
 * two halves of the bodyPoints test. `palette.foreground` is deliberately
 * absent: `ensureReadablePair` replaces it outright when it misses 4.5:1, and
 * over a background plate `layoutElement` forces copy to white, so a
 * prescription on it is honoured only sometimes. A correction that may or may
 * not happen is worse than no correction, because the next failure teaches
 * nothing. `aspectRatio` is absent for a different reason: it is what the user
 * asked for, not a quality lever.
 */
export const CORRECTABLE_FIELDS = [
  "headline",
  "subheadline",
  "cta",
  "logoPlacement",
  "palette.background",
  "palette.accent",
  "layout",
  "footerStyle",
  "footerLines",
  "backgroundPrompt",
  "backgroundTreatment",
  "nativePrompt",
] as const;

export type CorrectableField = (typeof CORRECTABLE_FIELDS)[number];

export type DesignRenderer = "composite" | "native";

/**
 * Which fields each route actually reads.
 *
 * The composite renderer draws the spec literally (render/layouts.tsx) and
 * generates its plate from `backgroundPrompt` (buildBackgroundPlatePrompt).
 * The native route sends one string: `buildNativePrompt` carries nativePrompt,
 * the copy, the palette and the logo corner, and never looks at `layout`, the
 * footer or the plate instruction. Prescribing a layout change to a native
 * variant would be the bodyPoints failure with a new field name.
 */
const FIELDS_BY_RENDERER: Record<DesignRenderer, readonly CorrectableField[]> =
  {
    composite: [
      "headline",
      "subheadline",
      "cta",
      "logoPlacement",
      "palette.background",
      "palette.accent",
      "layout",
      "footerStyle",
      "footerLines",
      "backgroundPrompt",
      "backgroundTreatment",
    ],
    native: [
      "headline",
      "subheadline",
      "cta",
      "logoPlacement",
      "palette.background",
      "palette.accent",
      "nativePrompt",
    ],
  };

/**
 * The fields this route draws, minus the ones this brand has nothing for.
 *
 * With no logo file there is no mark to composite, so a corner prescription
 * only asks the plate model to keep a corner calm for something that will
 * never be stamped — one spent correction pass for no pixel change.
 */
export function correctableFieldsFor(
  renderer: DesignRenderer,
  hasLogo = true,
): readonly CorrectableField[] {
  const fields = FIELDS_BY_RENDERER[renderer];
  return hasLogo ? fields : fields.filter((field) => field !== "logoPlacement");
}

/**
 * §11's map, reduced to levers this pipeline owns.
 *
 * The manual's remedies name things a human designer moves — crop, contact
 * shadows, overlap, product scale. Where the renderer has no such control the
 * remedy routes to the instruction that produces it: a crop or a shadow is
 * something the plate model draws, so it is reached through
 * `backgroundPrompt` / `nativePrompt`. Where it has no route at all (type
 * choice is the brand's font file, not the spec's) the remedy is omitted
 * rather than faked.
 */
export const SYMPTOM_CORRECTIONS: Record<
  DiagnosticSymptom,
  readonly CorrectableField[]
> = {
  // "increase distinctive brand anchors and message-specific imagery"
  generic: ["backgroundPrompt", "nativePrompt", "headline"],
  // "restore approved type, colour, logo, product treatment, or voice"
  "off-brand": [
    "palette.background",
    "palette.accent",
    "logoPlacement",
    "headline",
    "subheadline",
    "backgroundPrompt",
    "nativePrompt",
  ],
  // "vary layout, scene, crop, metaphor, or dominant background"
  repetitive: [
    "layout",
    "backgroundPrompt",
    "backgroundTreatment",
    "nativePrompt",
  ],
  // "reduce copy, decoration, products, or footer content"
  crowded: [
    "subheadline",
    "cta",
    "footerLines",
    "footerStyle",
    "headline",
    "backgroundTreatment",
  ],
  // "enlarge the main idea, improve grouping, or strengthen the hero"
  empty: ["layout", "headline", "backgroundPrompt", "nativePrompt"],
  // "create foreground/middle/background, scale contrast, shadow, and overlap"
  flat: ["backgroundPrompt", "backgroundTreatment", "nativePrompt"],
  // "correct light direction, contact shadows, perspective, edges, and texture"
  artificial: ["backgroundPrompt", "nativePrompt"],
  /* "separate it from body copy and use a recognised action component".
     nativePrompt is here for the reason stated at the top of this map: the
     native route draws no layout and no action pill, so the whole-design
     instruction is the only thing that draws the action at all. Without it
     this symptom reached one lever on that route — `cta`, the words — when the
     remedy §11 names is about separation and component, not wording. */
  "weak-cta": ["cta", "layout", "nativePrompt"],
  // "connect its geometry, colour, overlap, or spacing to the composition"
  "pasted-footer": ["footerStyle", "footerLines"],
};

export function prescribableFields(
  symptom: DiagnosticSymptom,
  renderer: DesignRenderer,
  hasLogo = true,
): readonly CorrectableField[] {
  const drawn = correctableFieldsFor(renderer, hasLogo);
  return SYMPTOM_CORRECTIONS[symptom].filter((field) => drawn.includes(field));
}

/**
 * Symptoms worth offering this route.
 *
 * The native route draws no footer, so "footer feels pasted on" has no
 * applicable remedy there. Withheld rather than offered and then refused: a
 * symptom with nothing behind it spends the one correction pass on nothing.
 */
export function symptomsFor(
  renderer: DesignRenderer,
  hasLogo = true,
): readonly DiagnosticSymptom[] {
  return DIAGNOSTIC_SYMPTOMS.filter(
    (symptom) => prescribableFields(symptom, renderer, hasLogo).length > 0,
  );
}

export function weakestCategory(scores: RubricScores): RubricCategory {
  return RUBRIC_CATEGORIES.reduce((worst, category) =>
    scores[category] < scores[worst] ? category : worst,
  );
}

/** The critical categories that tripped §10's override, in the manual's order. */
export function failedCriticalCategories(
  scores: RubricScores,
): RubricCategory[] {
  return CRITICAL_CATEGORIES.filter(
    (category) => scores[category] <= SERIOUS_FAILURE_SCORE,
  );
}

export function requiresRevision(scores: RubricScores): boolean {
  return failedCriticalCategories(scores).length > 0;
}

export interface PrescribedChange {
  field: CorrectableField;
  /** One value, as text. Enums are matched against their members, colours are
   *  normalised to hex, footer lines are read one per line, and an empty
   *  string means "take this off" where the renderer treats absence as a
   *  decision. Anything else is refused. */
  value: string;
}

export interface DesignVerdict {
  scores: RubricScores;
  /** §10 step 9's "lowest-scoring category", computed from the scores rather
   *  than asked for — the model has no business restating its own minimum. */
  weakest: RubricCategory;
  /** §10's override: brief accuracy, brand recognition or readability has
   *  failed, so this design needed revision whatever its total came to. The
   *  orchestrator records it — a corrected design that was serious tells the
   *  user something a merely low total does not. */
  seriousFailure: boolean;
  symptom: DiagnosticSymptom;
  /** What the judge asked for, as it asked for it — kept even when this module
   *  refused the prescription, so the log can say which guard rejected what. */
  change: PrescribedChange;
  reason: string;
  /** Whether the judge looked at the render or reasoned from the spec alone. */
  sawImage: boolean;
}

/** The change as it landed on the spec. `from` is what the trace needs and the
 *  prescription alone cannot give: a value in the log that no one can compare
 *  to anything is not evidence. */
export interface AppliedChange {
  field: CorrectableField;
  from: string;
  to: string;
}

export interface JudgedCorrection {
  /** True only when `spec` differs from the one passed in. The caller must not
   *  re-render on false: that is the dice re-roll this module replaces. */
  corrected: boolean;
  spec: DesignSpec;
  /** Non-null whenever the judge answered with a usable verdict, including
   *  when its prescription was then refused. Null means only that no verdict
   *  was obtained — the judge was never reached, timed out, or answered with
   *  something that was not a judgement at all. */
  verdict: DesignVerdict | null;
  applied: AppliedChange | null;
}

/* Vocabulary that must not appear in a plate instruction.
   buildBackgroundPlatePrompt hands this straight to the image model, and the
   composite renderer draws every word of copy itself — lettering in the plate
   lands underneath the typography. Matched as a flat vocabulary rather than
   parsed for negation: "never omit the text" and "omit the text" differ only
   in scope, and logo-placement.ts records three failed attempts at settling
   English negation with a regex. Over-refusing costs one correction; a plate
   full of garbled type costs the design.

   The one negation that IS settled is the explicit prohibition, because it is
   the instruction this module's own field guide gives: "a deep courtyard,
   lanterns close, no text" is the correct answer and used to be refused for
   echoing the brief. A forbidding phrase ("no text", "without words") is
   removed before matching, and only that — the words it forbids have to
   follow it, so "no clouds and the words KO OS" keeps its lettering and is
   still refused. */
const PROHIBITION = "(?:no|without|avoid|free\\s+of|devoid\\s+of)";
const PROHIBITION_FILLER =
  "(?:any|all|visible|legible|written|real|actual|overlaid|extra|additional|or|nor|and)";

const LETTERING_VOCABULARY =
  "(?:text|lettering|letters?|words?|wordmarks?|typograph\\w*|font|headlines?|captions?|subtitles?|slogans?|signage|signs?|labels?|watermarks?|logos?)";

/* The real logo file is composited over the native model's output, so a
   prompt that asks for a mark produces two (KOOS-BUG-022). */
const LOGO_VOCABULARY = "(?:logos?|wordmarks?|watermarks?|brand\\s+marks?)";

function vocabularyGuard(vocabulary: string) {
  const forbidden = `(?:[\\s,]+${PROHIBITION_FILLER})*[\\s,]+${vocabulary}`;
  return {
    present: new RegExp(`\\b${vocabulary}\\b`, "i"),
    prohibited: new RegExp(`\\b${PROHIBITION}(?:${forbidden})+\\b`, "gi"),
  };
}

const LETTERING_GUARD = vocabularyGuard(LETTERING_VOCABULARY);
const LOGO_GUARD = vocabularyGuard(LOGO_VOCABULARY);

function reachesFor(
  text: string,
  guard: { present: RegExp; prohibited: RegExp },
): boolean {
  return guard.present.test(text.replace(guard.prohibited, " "));
}

function member<T extends string>(
  value: string,
  options: readonly T[],
): T | null {
  return (options as readonly string[]).includes(value) ? (value as T) : null;
}

/* Validated by the spec's own field rather than against a copied list of
   members: footerStyle and backgroundTreatment each carry a default, so their
   members are not reachable as a plain array, and a second copy of an enum is
   a copy that drifts. */
function enumField<K extends "layout" | "footerStyle" | "backgroundTreatment">(
  field: K,
  value: string,
): DesignSpec[K] | null {
  const parsed = designSpecSchema.shape[field].safeParse(value);
  return parsed.success ? (parsed.data as DesignSpec[K]) : null;
}

/** The patch for one field, or null when the value cannot be used. */
function patchFor(
  spec: DesignSpec,
  { field, value }: PrescribedChange,
): { patch: Partial<DesignSpec>; applied: string } | null {
  const text = value.trim();

  switch (field) {
    case "headline":
      return text ? { patch: { headline: text }, applied: text } : null;

    case "subheadline":
      return {
        patch: { subheadline: text || undefined },
        applied: text,
      };

    /* §11's "reduce copy" for a crowded design is the supporting line, and
       §10 scores ctaFooter on "the action is visible" — so subheadline is the
       only copy a correction may empty. Deleting the user's call to action is
       damage wearing a verdict. footerLines stays emptiable: "reduce copy,
       decoration, products, or footer content" is §11's own remedy and
       drawnFooter() already refuses the cases that render identically. */
    case "cta":
      return text ? { patch: { cta: text }, applied: text } : null;

    case "layout": {
      const layout = enumField("layout", text);
      return layout ? { patch: { layout }, applied: layout } : null;
    }

    case "backgroundTreatment": {
      const treatment = enumField("backgroundTreatment", text);
      if (!treatment) return null;
      /* treatmentClause renders this one as "Flat solid colour field", and
         checks.ts measures a flat frame at 0.003 B/px against its
         BLANK_MAX_BYTES_PER_PIXEL floor of 0.05 — so prescribing it buys the
         blank-frame fault this module exists to answer. It stays legal in the
         schema, where the art director may choose it deliberately for a design
         that carries its own detail; it is not a correction. */
      if (treatment === "solid") return null;
      return { patch: { backgroundTreatment: treatment }, applied: treatment };
    }

    case "footerStyle": {
      const style = enumField("footerStyle", text);
      return style ? { patch: { footerStyle: style }, applied: style } : null;
    }

    case "footerLines": {
      const lines = text
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      /* The band draws three lines and no more (render/footer.ts), and
         footerLinesFor would silently drop the rest. A prescription that only
         partly lands is refused, so what the judge asked for and what the
         design carries never diverge. */
      if (lines.length > MAX_FOOTER_LINES) return null;
      return { patch: { footerLines: lines }, applied: lines.join("\n") };
    }

    case "logoPlacement": {
      const placement = member(text, LOGO_PLACEMENTS);
      /* "none" is the escape hatch that silently deleted the brand's mark
         (KOOS-BUG-022). A critic may move the logo; it may never remove it. */
      if (!placement || placement === "none") return null;
      if (!allowedCornersFor(spec.layout).includes(placement)) return null;
      return { patch: { logoPlacement: placement }, applied: placement };
    }

    case "palette.background":
    case "palette.accent": {
      /* resolvePalette drops anything that is not a hex and falls back to the
         brand's own colours, so a colour name is a prescription with no
         effect. */
      const hex = normalizeHex(text);
      if (!hex) return null;
      const slot = field === "palette.background" ? "background" : "accent";
      return {
        patch: { palette: { ...spec.palette, [slot]: hex } },
        applied: hex,
      };
    }

    case "backgroundPrompt":
      if (!text || reachesFor(text, LETTERING_GUARD)) return null;
      return { patch: { backgroundPrompt: text }, applied: text };

    case "nativePrompt":
      if (!text || reachesFor(text, LOGO_GUARD)) return null;
      return { patch: { nativePrompt: text }, applied: text };
  }
}

/**
 * Keeps the mark on a corner the composition still leaves free.
 *
 * A layout or footer change moves the copy, and a mark that was clear of it
 * may not be any more: banner-bottom draws left-aligned copy across the lower
 * band, and a footer band covers both bottom corners. `resolveLogoPlacement`
 * is the pipeline's authority on this, so it is re-run rather than reasoned
 * about again — which also means a prescribed corner that this would overrule
 * fails the "did the change land" check below instead of being quietly moved.
 */
function keepLogoClearOfCopy(spec: DesignSpec): DesignSpec {
  if (spec.logoPlacement === "none") return spec;
  return {
    ...spec,
    logoPlacement: resolveLogoPlacement({
      modelChoice: spec.logoPlacement,
      /* Must stay true: resolveLogoPlacement returns "none" when hasLogo is
         false (logo-placement.ts), so threading the real value through here
         would silently delete the brand's mark from a spec that already says
         where it goes — KOOS-BUG-022 again. Whether a mark is composited at
         all is the compositor's call, not this re-resolution's. */
      hasLogo: true,
      layout: spec.layout,
      logoFree: spec.logoFree,
      footer: {
        footerStyle: spec.footerStyle,
        footerLines: spec.footerLines,
      },
    }),
  };
}

function currentValue(spec: DesignSpec, field: CorrectableField): string {
  switch (field) {
    case "headline":
      return spec.headline;
    case "subheadline":
      return spec.subheadline ?? "";
    case "cta":
      return spec.cta ?? "";
    case "layout":
      return spec.layout;
    case "backgroundTreatment":
      return spec.backgroundTreatment;
    case "footerStyle":
      return spec.footerStyle;
    case "footerLines":
      return spec.footerLines.join("\n");
    case "logoPlacement":
      return spec.logoPlacement;
    case "palette.background":
      return spec.palette.background;
    case "palette.accent":
      return spec.palette.accent;
    case "backgroundPrompt":
      return spec.backgroundPrompt;
    case "nativePrompt":
      return spec.nativePrompt;
  }
}

const FOOTER_FIELDS: readonly CorrectableField[] = [
  "footerStyle",
  "footerLines",
];

/**
 * The footer as the canvas gets it, or nothing at all.
 *
 * `hasFooter` is false when the style is "none" OR when no line carries text,
 * so a `footerLines` prescription on a "none" footer — and a `footerStyle`
 * flip while the lines are empty — both leave `FooterBand` returning null and
 * the render byte-identical. Reported as a correction, that is the dice
 * re-roll wearing a verdict, which is the whole defect this module removes.
 */
function drawnFooter(spec: DesignSpec): string {
  return hasFooter(spec)
    ? `${spec.footerStyle}:${footerLinesFor(spec).join("\n")}`
    : "";
}

/**
 * Which guard turned a prescription down.
 *
 * Named rather than collapsed to a boolean because "the judge answered and we
 * refused it" is the number that tunes the guards, and an acceptance rate is
 * only actionable when it says what is doing the refusing. `eval:design-judge`
 * reads these.
 */
export type RefusalReason =
  /** The route does not draw the field, or this brand has no mark for it. */
  | "field-not-drawn"
  /** The value is not a legal member, hex, line count or plate instruction. */
  | "value-unusable"
  /** The value is what the spec already carries. */
  | "no-change"
  /** The patched spec does not satisfy designSpecSchema. */
  | "schema"
  /** Something downstream overruled it, so the field does not read back. */
  | "overruled-downstream"
  /** The footer change leaves `FooterBand` drawing exactly what it drew. */
  | "footer-not-drawn";

export type PrescriptionOutcome =
  | { ok: true; spec: DesignSpec; applied: AppliedChange }
  | { ok: false; refusedBy: RefusalReason };

function correct(
  spec: DesignSpec,
  change: PrescribedChange,
  renderer: DesignRenderer,
  hasLogo: boolean,
): PrescriptionOutcome {
  if (!correctableFieldsFor(renderer, hasLogo).includes(change.field)) {
    return { ok: false, refusedBy: "field-not-drawn" };
  }

  const from = currentValue(spec, change.field);
  const patched = patchFor(spec, change);
  if (!patched) return { ok: false, refusedBy: "value-unusable" };
  if (patched.applied === from) return { ok: false, refusedBy: "no-change" };

  const parsed = designSpecSchema.safeParse(
    keepLogoClearOfCopy({ ...spec, ...patched.patch }),
  );
  if (!parsed.success) return { ok: false, refusedBy: "schema" };

  /* The prescription has to survive every guard between here and the canvas.
     If the field does not read back as prescribed, something downstream
     overruled it, and a re-render on a spec the judge did not actually get is
     the dice re-roll wearing a verdict. */
  if (currentValue(parsed.data, change.field) !== patched.applied) {
    return { ok: false, refusedBy: "overruled-downstream" };
  }

  if (
    FOOTER_FIELDS.includes(change.field) &&
    drawnFooter(parsed.data) === drawnFooter(spec)
  ) {
    return { ok: false, refusedBy: "footer-not-drawn" };
  }

  return {
    ok: true,
    spec: parsed.data,
    applied: { field: change.field, from, to: patched.applied },
  };
}

/**
 * The corrected spec and the guard that refused it, for one prescription.
 *
 * Pure and total: every rejection is a deterministic property of the value,
 * the spec and the route, so the same prescription is always answered the same
 * way — which is what lets the eval re-derive the reason from the recorded
 * verdict instead of threading it through the model call.
 */
export function prescriptionOutcome(
  spec: DesignSpec,
  change: PrescribedChange,
  renderer: DesignRenderer,
  hasLogo = true,
): PrescriptionOutcome {
  return correct(spec, change, renderer, hasLogo);
}

/** The corrected spec, or null when the prescription cannot be used. */
export function applyPrescribedChange(
  spec: DesignSpec,
  change: PrescribedChange,
  renderer: DesignRenderer,
  hasLogo = true,
): DesignSpec | null {
  const outcome = correct(spec, change, renderer, hasLogo);
  return outcome.ok ? outcome.spec : null;
}

/** Long enough for a real vision call, short enough that the correction pass
 *  is not itself the wait the user notices. A critic slower than a re-render
 *  is worse than no critic. */
export const JUDGE_TIMEOUT_MS = 20_000;

/** Bedrock's 4096 default truncated large generateObject answers into
 *  "did not match schema" loops; this answer is small, so it is capped small. */
export const JUDGE_MAX_OUTPUT_TOKENS = 900;

function judgeSchema(renderer: DesignRenderer, hasLogo: boolean) {
  const symptoms = symptomsFor(renderer, hasLogo);
  const fields = correctableFieldsFor(renderer, hasLogo);

  return z.object({
    /* Plain numbers, clamped afterwards. A range constraint here compiles into
       the decoding grammar and turns a model that answers 6 into a
       schema-validation retry loop instead of a verdict — the trade spec.ts
       already documents for colour values. */
    scores: z.object(
      Object.fromEntries(
        RUBRIC_CATEGORIES.map((category) => [category, z.number()]),
      ) as Record<RubricCategory, z.ZodNumber>,
    ),
    symptom: z.enum(symptoms as [DiagnosticSymptom, ...DiagnosticSymptom[]]),
    change: z.object({
      field: z.enum(fields as [CorrectableField, ...CorrectableField[]]),
      value: z.string(),
    }),
    reason: z.string(),
  });
}

/** What each lever controls, in terms of what the renderer draws with it. */
const FIELD_GUIDE: Record<CorrectableField, string> = {
  headline:
    "the dominant line, set in the brand display face and sized to the room the layout leaves. A few words.",
  subheadline:
    "the supporting line under the headline. An empty value takes it off the design.",
  cta: "the action, drawn as a filled pill in the accent colour. You may reword it. You may never take it off the design.",
  logoPlacement:
    "which corner the brand's real logo file is composited into. You may move it between corners the layout leaves free. You may never remove it.",
  "palette.background":
    "the ground colour of the design. A six-digit hex value.",
  "palette.accent":
    "the colour of the action pill and the stat-highlight border. A six-digit hex value.",
  layout:
    "the layout family: hero-center (copy centred over the full frame), split-left (copy in the left half, image in the right), banner-bottom (image above, copy in a band across the bottom), quote-card (centred panel), stat-highlight (centred panel with an accent border).",
  footerStyle:
    "how utility details are drawn: 'bar' is a solid band across the bottom that reads over any image, 'text' is plain lines on the design, 'none' draws no band at all.",
  footerLines:
    "the utility details themselves — phone, website, venue, date — one per line, at most three lines of at most 60 characters. An empty value clears them.",
  backgroundPrompt:
    "the instruction for the text-free background plate. Describe a scene and its light only. It must contain no reference to text, letters, words, captions, signage or a logo: the renderer draws all the type itself and any lettering in the plate lands underneath it.",
  backgroundTreatment:
    "how the plate is rendered: photographic, illustration, gradient or pattern. A flat solid field is not an option here — it renders below the density floor the automated check already measures.",
  nativePrompt:
    "the whole-design instruction for a model that renders its own type. Describe the finished design including the copy. Never ask for a logo: the brand's real file is composited on top afterwards, and asking for both produces two.",
};

const ROUTE_NOTE: Record<DesignRenderer, string> = {
  composite:
    "This design was drawn by the compositor: a generated background plate with the typography, the footer and the logo drawn on top from the spec. Every field below is drawn literally.",
  native:
    "This design was drawn in one pass by a model that renders its own type, from the spec's nativePrompt, copy, palette and logo corner. It has no layout template and no footer band, so those are not levers here.",
};

export function buildJudgeSystemPrompt({
  renderer,
  brand,
  hasLogo,
}: {
  renderer: DesignRenderer;
  brand: BrandSummary;
  hasLogo: boolean;
}): string {
  const fields = correctableFieldsFor(renderer, hasLogo);
  const symptoms = symptomsFor(renderer, hasLogo);
  /* anchorsBlock claims "the palette comes from these colours" and then names
     none of them, so brandRecognition was scored and hexes were prescribed
     blind — the model's only option was to invent an approved colour. The
     values go here, beside the claim, rather than in the per-design half of
     the prompt: they are a property of the brand, not of this render. */
  const brandContext =
    `${anchorsBlock(brand, { hasLogo })}${brandPalette(brand)}`.trim();

  return [
    `You are a senior art director reviewing one design for ${brand.name || "this brand"} that has already failed an automated pre-delivery check. It will be re-rendered exactly once, with exactly one change that you choose. There is no second opinion and no second attempt.`,
    ROUTE_NOTE[renderer],
    `Score these ten categories from 1 to 5, where 1 is a failure and 5 is work you would send to the client:\n${RUBRIC_CATEGORIES.map(
      (category) => `- ${category}: ${RUBRIC_CRITERIA[category]}`,
    ).join("\n")}`,
    /* The symptom and the field are one decision, not two. `prescribableFields`
       refuses a field outside the named symptom's row, and the prompt used to
       list the symptoms and the fields separately — so a judge could read the
       design correctly, prescribe the right change, and have it discarded for
       a pairing it was never shown. Generated from the same map the guard
       reads, so the two cannot drift. */
    `Then name the single symptom that best describes what is wrong. The symptom decides which fields you may then change, so pick the pair rather than the label:\n${symptoms
      .map(
        (symptom) =>
          `- ${symptom} — you may then change ${prescribableFields(
            symptom,
            renderer,
            hasLogo,
          )
            .map((field) => `"${field}"`)
            .join(", ")}`,
      )
      .join("\n")}`,
    `Then prescribe ONE change, from the list your symptom allows. Fix the lowest-scoring category first, and make the smallest change that fixes it — do not answer a weak hierarchy by adding decoration. What each field controls:\n${fields
      .map((field) => `- "${field}": ${FIELD_GUIDE[field]}`)
      .join("\n")}`,
    "Rules on the change itself:\n- One field. Give the complete new value for it, not a description of what to do.\n- Never invent a fact. Phone numbers, prices, dates, addresses and claims must already be in the brief or the brand. Keep a placeholder like [EVENT DATE] as a placeholder.\n- The field has to be one your symptom allows. If the change you want is not on that symptom's list, you have named the wrong symptom — name the one whose remedy you actually want. A prescription outside the list is discarded and the design ships as it is.",
    brandContext,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/* Only the brief's opening. A calendar brief runs to thousands of words, and
   the rubric is what this call is for — a brief that crowds it out buys worse
   judgement at a higher price. */
const BRIEF_EXCERPT_CHARS = 1500;

export function buildJudgeUserPrompt({
  spec,
  renderer,
  faults,
  brief,
  sawImage,
  hasLogo = true,
}: {
  spec: DesignSpec;
  renderer: DesignRenderer;
  faults: DesignFault[];
  brief: string | null;
  sawImage: boolean;
  hasLogo?: boolean;
}): string {
  const drawn = correctableFieldsFor(renderer, hasLogo);

  return [
    `The brief:\n${brief?.trim().slice(0, BRIEF_EXCERPT_CHARS) || "(no brief text was recorded for this design)"}`,
    `What the automated check found:\n${faultSummary(faults)}`,
    `The spec this design was rendered from:\n${drawn
      .map((field) => `- ${field}: ${currentValue(spec, field) || "(empty)"}`)
      .join("\n")}`,
    sawImage
      ? "The rendered design is attached. Judge what you can see, not what the spec says should be there."
      : "The rendered image cannot be read, so there is nothing to look at. Judge the spec itself: what it would produce, and which field is most likely to have caused the failure above.",
  ].join("\n\n");
}

/** PNG or JPEG, read from the bytes rather than from a caller's content type —
 *  the adapters have returned a JPEG labelled as a PNG before. */
function mediaTypeOf(bytes: Uint8Array): string | null {
  if (readPngDimensions(bytes)) return "image/png";
  if (readJpegDimensions(bytes)) return "image/jpeg";
  return null;
}

/**
 * Whether there is anything worth showing the judge.
 *
 * Unreadable bytes have no image in them. A blank frame has one, but nothing
 * in it: `checkRenderedDesign` has already measured it as flat and said so in
 * words, so sending it spends vision tokens on an empty rectangle.
 */
function visualEvidence(
  bytes: Uint8Array | null,
  faults: DesignFault[],
): { bytes: Uint8Array; mediaType: string } | null {
  if (!bytes?.length) return null;
  if (faults.some((fault) => fault.code === "blank-frame")) return null;
  const mediaType = mediaTypeOf(bytes);
  return mediaType ? { bytes, mediaType } : null;
}

function clampScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_SCORE, Math.max(MIN_SCORE, Math.round(value)));
}

/* A score that is not a number is not a judgement, and substituting a neutral
   3 would invent the one the model failed to give. The whole verdict is
   dropped instead; the design the user already has is the fallback. */
function readScores(raw: unknown): RubricScores | null {
  if (!raw || typeof raw !== "object") return null;
  const source = raw as Record<string, unknown>;
  const scores = {} as RubricScores;
  for (const category of RUBRIC_CATEGORIES) {
    const score = clampScore(source[category]);
    if (score === null) return null;
    scores[category] = score;
  }
  return scores;
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  /* The loser of the race still settles. Without a handler its rejection is
     unhandled and crashes the worker that the fail-soft path exists to
     protect. */
  void work.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`design judge timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface JudgeAndCorrectArgs {
  spec: DesignSpec;
  renderer: DesignRenderer;
  /** What `checkRenderedDesign` found. Empty means the design passed, and the
   *  judge is never worth a model call for a design that passed. */
  faults: DesignFault[];
  /** The rendered bytes, whatever state they are in. */
  image: Uint8Array | null;
  brief: string | null;
  brand: BrandSummary;
  /** Whether a real logo file will be composited. False takes `logoPlacement`
   *  off the table: there is no mark for a corner to hold. */
  hasLogo: boolean;
  /** Bounded so one slow provider cannot hold the job open. Overridable for
   *  tests and the offline eval, which need a budget of their own. */
  timeoutMs?: number;
}

/**
 * Judge one failed design and correct its spec, once.
 *
 * Returns `corrected: false` with the spec untouched for every unusable
 * outcome: no faults, a provider that refused, a timeout, scores that are not
 * numbers, a prescription outside §11's map for the named symptom, and a
 * prescription the schema or the renderer would discard. The caller keeps the
 * design it has and decides for itself whether a plain re-roll is still worth
 * one attempt — what it must never do is re-render a spec it was not told had
 * changed.
 *
 * The verdict survives a refused prescription. "The judge was never reached"
 * and "the judge answered and we refused it" are different problems — the
 * second is how the guards above get tuned — so only the first reads as
 * `verdict: null`.
 */
export async function judgeAndCorrect(
  args: JudgeAndCorrectArgs,
): Promise<JudgedCorrection> {
  const unchanged: JudgedCorrection = {
    corrected: false,
    spec: args.spec,
    verdict: null,
    applied: null,
  };

  try {
    return await judgePass(args, unchanged);
  } catch (err) {
    /* The inner pass already guards the model call. This is the boundary that
       makes losing a rendered design impossible rather than unlikely: one
       unguarded parse added later cannot cost the user their design. */
    console.error("design correction pass failed", err);
    return unchanged;
  }
}

async function judgePass(
  args: JudgeAndCorrectArgs,
  unchanged: JudgedCorrection,
): Promise<JudgedCorrection> {
  const { spec, renderer, faults, image, brief, brand, hasLogo } = args;

  if (faults.length === 0) return unchanged;

  const evidence = visualEvidence(image, faults);
  const sawImage = evidence !== null;

  try {
    const { object } = await withTimeout(
      generateObject({
        /* The same feature as the art director this reviews: a critic weaker
           than the thing it judges is a rubber stamp, and "strategy" is the
           registry's reasoning tier (provider-config.ts). It is also the only
           one the design pipeline already depends on, so the judge cannot be
           the reason a brand with one configured feature stops working. The
           per-feature override exists if an operator wants to split them. */
        model: getModel("strategy"),
        schema: judgeSchema(renderer, hasLogo),
        maxOutputTokens: JUDGE_MAX_OUTPUT_TOKENS,
        abortSignal: AbortSignal.timeout(args.timeoutMs ?? JUDGE_TIMEOUT_MS),
        system: buildJudgeSystemPrompt({ renderer, brand, hasLogo }),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: buildJudgeUserPrompt({
                  spec,
                  renderer,
                  faults,
                  brief,
                  sawImage,
                  hasLogo,
                }),
              },
              ...(evidence
                ? [
                    {
                      type: "image" as const,
                      image: evidence.bytes,
                      mediaType: evidence.mediaType,
                    },
                  ]
                : []),
            ],
          },
        ],
      }),
      args.timeoutMs ?? JUDGE_TIMEOUT_MS,
    );

    const scores = readScores(object?.scores);
    if (!scores) return unchanged;

    const symptom = object?.symptom;
    if (!symptom || !symptomsFor(renderer, hasLogo).includes(symptom)) {
      return unchanged;
    }

    const field = object?.change?.field;
    const value = object?.change?.value;
    /* No prescription is not a verdict this module can carry: DesignVerdict
       exists to say what to change, and §10's scores without §11's answer are
       half an answer the caller cannot act on or tune a guard from. */
    if (!field || typeof value !== "string") return unchanged;

    const verdict: DesignVerdict = {
      scores,
      weakest: weakestCategory(scores),
      seriousFailure: requiresRevision(scores),
      symptom,
      change: { field, value },
      reason: typeof object?.reason === "string" ? object.reason : "",
      sawImage,
    };

    if (!prescribableFields(symptom, renderer, hasLogo).includes(field)) {
      return { ...unchanged, verdict };
    }

    const corrected = correct(spec, { field, value }, renderer, hasLogo);
    if (!corrected.ok) return { ...unchanged, verdict };

    return {
      corrected: true,
      spec: corrected.spec,
      verdict,
      applied: corrected.applied,
    };
  } catch (err) {
    /* Includes a provider that rejects image parts outright, a timeout, and an
       answer that did not match the schema. None of them is a reason for the
       user to lose a design. */
    console.error("design judge unavailable", err);
    return unchanged;
  }
}

/** One log line: the symptom, the rubric total and both sides of the change,
 *  so a corrected design can be told from a re-roll after the fact. */
export function correctionSummary(result: JudgedCorrection): string {
  const { verdict, applied } = result;
  if (!verdict) return "no verdict";

  const total = RUBRIC_CATEGORIES.reduce(
    (sum, category) => sum + verdict.scores[category],
    0,
  );
  /* The categories that CAUSED the override, not `weakest`. §10's override is
     tripped by brief accuracy, brand recognition or readability alone, and the
     lowest-scoring category is routinely a different one — so the log line
     named a category that had nothing to do with the word beside it. */
  const serious = failedCriticalCategories(verdict.scores);
  const head = `${verdict.symptom}, ${total}/50${serious.length > 0 ? ` (serious: ${serious.join(", ")})` : ""}`;

  return applied
    ? `${head} — ${applied.field}: "${oneLine(applied.from)}" → "${oneLine(applied.to)}"`
    : `${head} — ${verdict.change.field} refused`;
}

/* footerLines is newline-separated and a prompt can be long. A trace line that
   wraps across the log is a trace line nobody greps. */
function oneLine(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 79)}…` : flat;
}
