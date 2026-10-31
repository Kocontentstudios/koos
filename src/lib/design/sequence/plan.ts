import { generateObject } from "ai";
import type { z } from "zod";
import {
  buildArcCopyPrompt,
  buildArcPrompt,
  buildAuditPrompt,
  buildFixPrompt,
  buildPickPrompt,
  buildSequenceSystemPrompt,
  type ClaimedFrame,
} from "@/lib/ai/prompts/design-sequence";
import { getModel } from "@/lib/ai/provider";
import {
  ART_DIRECTOR_IMAGE_MAX_BYTES,
  brandFacts,
} from "@/lib/jobs/directions/brief";
import {
  type BriefReader,
  readBriefWithModel,
} from "@/lib/jobs/directions/brief-read";
import { type ArcFrame, pointPool, settleArc, sparePoints } from "./arc";
import { auditFlags } from "./audit";
import { withConsistentCasing } from "./casing";
import {
  type FrameBeat,
  type PlannedSequence,
  type PlanSequenceInput,
  type PlanSequenceResult,
  PRESENTATION_ASPECT,
} from "./contract";
import { withFactsDrawn } from "./coverage";
import {
  blockingFaults,
  type CopyFault,
  type FaultRules,
  type Flag,
  setFaults,
} from "./faults";
import { applyFixes, copyKey, fixesFor, newClaims, tidyLines } from "./fixes";
import { shipGate, unsourcedOnSet } from "./gate";
import { type AlternateCopy, lastResort } from "./last-resort";
import { withFigureLayout } from "./layouts";
import { sequenceLedger } from "./ledger";
import {
  fixedArcAnswer,
  outlinePool,
  ownedClaims,
  ownerStatements,
} from "./outline-arc";
import { type Draft, settlePick } from "./pick";
import { profileStatements } from "./points";
import { failure, frameCountError, readSequenceBrief } from "./read";
import {
  profileWithout,
  releasedFacts,
  removedFromBrief,
  removedPoints,
  removedSaidBy,
} from "./removed";
import { repairSequenceFor } from "./repair";
import { type FrameRepeat, withoutRepeats } from "./repeats";
import {
  type ArcAnswer,
  arcResponseSchema,
  auditResponseSchema,
  type CopyAnswer,
  copyResponseSchema,
  type PickAnswer,
  pickResponseSchema,
  rewriteResponseSchema,
} from "./schema";
import { settledTitle, type TitleRules, withSettledTitles } from "./title";
import { validateSequence } from "./validate";

const ARC_MAX_OUTPUT_TOKENS = 3000;
const SAYABLE_KINDS = new Set(["date", "day", "time", "place", "contact"]);
/** N frames of copy, the button and the other openings. */
const COPY_MAX_OUTPUT_TOKENS = 8000;
const AUDIT_MAX_OUTPUT_TOKENS = 2000;
const PICK_MAX_OUTPUT_TOKENS = 600;
const FIX_MAX_OUTPUT_TOKENS = 6000;

/* The brief read, the arc, two drafts of copy, the editor's pick, the
   audit and two fix calls are eight; the rest covers a schema retry on two
   of them. Past that a fix is skipped rather than the wait growing. */
export const MAX_MODEL_CALLS = 10;

/** Thrown in place of a call past MAX_MODEL_CALLS. */
export class ModelBudgetError extends Error {
  constructor() {
    super(`planSequence: past its ${MAX_MODEL_CALLS} model calls`);
    this.name = "ModelBudgetError";
  }
}

export interface PlanSequenceDeps {
  /** Reads the brief's facts, offering and people (brief-read.ts). */
  briefReader?: BriefReader;
  /** What a set still carrying a blocking fault after every repair does
   *  (blockingFaults: a breach such as a claim no source gives or a point
   *  the owner took out, or a quality fault such as a repeat or a bare
   *  frame): "refuse" (the default, and production's) throws
   *  SequenceShipRefusedError before any frame is rendered or billed;
   *  "report" returns the set with `refused` set, so the eval can score
   *  it and count it. */
  onBlocked?: "refuse" | "report";
  /** Handed what code's last resort is about to repair, every time it
   *  runs: the eval keeps it so a refused set can be replayed against a
   *  changed last resort without paying for the model calls again. */
  onLastResort?: (input: LastResortInput) => void;
}

/** Everything lastResort and the planner's settle step read. */
export interface LastResortInput {
  plan: PlannedSequence;
  rules: FaultRules;
  claims: string[];
  alternates: AlternateCopy[][];
  titleRules: TitleRules;
  arcTitles: string[][];
  casingSources: string[];
}

/** Thrown in place of a set that still carries a blocking fault after
 *  every repair: the fix calls, code's last resort, one more fix call on
 *  what is left, and the last resort again. */
export class SequenceShipRefusedError extends Error {
  constructor(readonly faults: readonly FrameRepeat[]) {
    super(
      `planSequence: refused to ship ${faults.length} blocking fault(s): ${faults
        .map((f) => `frame ${f.frame + 1}: ${f.detail}`)
        .join("; ")
        .slice(0, 600)}`,
    );
    this.name = "SequenceShipRefusedError";
  }
}

/** The contract's result, plus the copy faults no rewrite fixed: drawable,
 *  so never a problem the job fails a set for, but measured by the eval and
 *  logged, so a fault that ships is counted rather than silent. */
export interface PlannedSequenceResult extends PlanSequenceResult {
  faults: FrameRepeat[];
  /** Words on a frame that neither the brief nor the brand vouches for
   *  (inventedOn), by zero-based frame. Held to the ledger a regenerate is
   *  refused on, so planning and regenerating apply one standard. */
  invented: { frame: number; text: string }[];
  /** Brief facts the copy left out that code wrote onto a frame's footer
   *  in the brief's own words (withFactsDrawn). */
  factsDrawn: string[];
  /** Brief facts the owner took out of the approved outline
   *  (releasedFacts): not required on any frame, and kept off them. */
  factsReleased: string[];
  /** Blocking faults still on the set, breaches and quality faults alike;
   *  only ever non-empty with onBlocked "report". */
  refused: FrameRepeat[];
  /** "frame k: how code rewrote it" for every frame the last resort
   *  rewrote from its own point. */
  lastResort: string[];
}

type BrandFrame = Pick<
  ArcAnswer,
  | "palette"
  | "logoPlacement"
  | "logoFree"
  | "logoFreeQuote"
  | "backgroundTreatment"
  | "footerStyle"
>;

/** The settled arc and its copy as one plan every frame of the set
 *  shares. */
export function assemblePlan(
  input: Pick<PlanSequenceInput, "kind" | "context">,
  brand: BrandFrame,
  arc: readonly ArcFrame[],
  copy: Pick<CopyAnswer, "frames" | "cta">,
): PlannedSequence {
  const frames: FrameBeat[] = arc.map((frame, i) => {
    const written = copy.frames[i];
    return {
      role: frame.role,
      title: settledTitle(written.title, frame.title),
      headline: written.headline.trim(),
      subheadline: written.subheadline.trim(),
      cta: frame.role === "cta" ? copy.cta.trim() : "",
      footerLines: tidyLines(written.footerLines),
      layout: frame.layout,
      showsImage: frame.showsImage,
      backgroundPrompt: written.backgroundPrompt.trim(),
    };
  });
  /* The set has one footer system. A model that chose none and then gave
     a frame its venue and phone would lose them, so the lines win. */
  const anyLines = frames.some((f) => f.footerLines.length > 0);
  const footerStyle =
    anyLines && brand.footerStyle === "none" ? "text" : brand.footerStyle;
  return {
    kind: input.kind,
    palette: { ...brand.palette },
    logoPlacement: brand.logoPlacement,
    logoFree: brand.logoFree,
    logoFreeQuote: brand.logoFreeQuote,
    backgroundTreatment: brand.backgroundTreatment,
    footerStyle,
    aspectRatio:
      input.kind === "presentation"
        ? PRESENTATION_ASPECT
        : input.context.aspectRatio,
    frames,
  };
}

/**
 * The set's plan, arc first:
 *  1. The brief is read the way the directions path reads it
 *     (readBriefWithModel, settleBriefRead, sequenceFacts), so a set is
 *     held to the same facts a single design is.
 *  2. Code builds the pool of points the set may make (pointPool): the
 *     brief's clauses, its facts that are a point on their own, the brand
 *     profile's clauses, none overlapping another.
 *  3. The arc call ranks the pool and assigns one point to each frame,
 *     writing only the hook's angle; code settles it (settleArc): no point
 *     overlapping another frame's, every fact on exactly one frame, prices
 *     beside the action, layouts.
 *  4. The copy call writes every frame told only its own claim and the
 *     claims and facts it must leave to the others, and frame 1 three ways;
 *     code keeps the opening with the fewest faults.
 *  5. The audit call reads the written set for what words cannot show:
 *     two frames making one point in other words, a statement no source
 *     gives, and which spare points are still unsaid (auditFlags).
 *  6. Code finds what is wrong (setFaults, the audit's findings among
 *     them) and the fix call rewrites only the frames at fault, a frame
 *     whose point is another's given a spare point; a version is kept only
 *     where the set improves.
 *  7. What must not ship is settled in code (shipGate): unsourced words
 *     cut, a priced or repeated headline set to its claim, a broken or
 *     missing subheadline set to its claim, a hook's echo cut, the
 *     offering named on the hook. What still blocks after it, the gate's
 *     own cuts included, goes to a second fix call and through the gate
 *     again. A fact still missing is written in the brief's words
 *     (withFactsDrawn), every title is settled against its frame's final
 *     copy (withSettledTitles) and the set takes one casing.
 *  At most MAX_MODEL_CALLS calls, the brief read included.
 *  8. A set still carrying a blocking fault is planned afresh, up to
 *     SHIP_ATTEMPTS times, and the one with the fewest is kept; with any
 *     left it is refused (onBlocked "refuse") or reported.
 */
export async function planSequence(
  input: PlanSequenceInput,
  {
    briefReader = readBriefWithModel,
    onBlocked = "refuse",
    onLastResort,
  }: PlanSequenceDeps = {},
): Promise<PlannedSequenceResult> {
  const read = onceRead(briefReader);
  let best: PlannedSequenceResult | null = null;
  let modelCalls = 0;
  for (let attempt = 1; attempt <= SHIP_ATTEMPTS; attempt += 1) {
    let result: PlannedSequenceResult;
    try {
      result = await planSequenceOnce(input, read, onLastResort);
    } catch (err) {
      /* A later attempt that fails leaves the best set so far to judge. */
      if (!best) throw err;
      console.error("sequence replan failed", failure(err));
      break;
    }
    modelCalls += result.modelCalls;
    if (!best || result.refused.length < best.refused.length) best = result;
    if (best.refused.length === 0) break;
    console.info("design.sequence.replanned", {
      attempt,
      blockingFaults: result.refused.length,
    });
  }
  const chosen = { ...(best as PlannedSequenceResult), modelCalls };
  if (chosen.refused.length > 0 && onBlocked === "refuse") {
    throw new SequenceShipRefusedError(chosen.refused);
  }
  return chosen;
}

/* A set still carrying a blocking fault after every repair is planned
   afresh before it is refused: the drafts differ run to run, and a second
   or third is often clean where the first was not. Bounded so a job never
   spends more than three plans' worth of calls (each at most
   MAX_MODEL_CALLS); the brief is read once. */
export const SHIP_ATTEMPTS = 3;

/* The brief reads the same every attempt: read it once. */
function onceRead(reader: BriefReader): BriefReader {
  let cached: ReturnType<BriefReader> | null = null;
  return (input) => {
    cached ??= reader(input);
    return cached;
  };
}

async function planSequenceOnce(
  input: PlanSequenceInput,
  briefReader: BriefReader,
  onLastResort?: PlanSequenceDeps["onLastResort"],
): Promise<PlannedSequenceResult> {
  const { context, kind, frameCount, imageSource, image } = input;
  const countError = frameCountError("planSequence", kind, frameCount);
  if (countError) throw new RangeError(countError);
  const outline = input.approvedOutline ?? null;
  if (outline && outline.points.length !== frameCount) {
    throw new RangeError(
      `planSequence: the approved outline has ${outline.points.length} points for ${frameCount} frames`,
    );
  }
  const started = Date.now();
  const memorySummary = input.memorySummary ?? "";
  const aspectRatio =
    kind === "presentation" ? PRESENTATION_ASPECT : context.aspectRatio;
  const hasImage = imageSource !== "none";
  const brief = await readSequenceBrief(context, kind, briefReader);
  let modelCalls = 1;
  const {
    briefText,
    brandName,
    facts,
    offering,
    offeringIndex,
    names,
    free,
    atAction,
  } = brief;
  const stated = ownerStatements(outline);
  const planned = pointPool({
    facts,
    briefText,
    brand: context.brandSummary,
    kind,
    free,
    slots: frameCount - 1,
    atAction,
  });
  const pool = outline ? outlinePool(outline, facts) : planned;
  const removedPool = outline
    ? removedPoints(outline, planned, facts, free)
    : [];
  const removed = removedPool.map((p) => p.text);
  const released = outline
    ? releasedFacts(outline, planned, facts, free).map((n) => facts[n].text)
    : [];
  /* Every prompt reads the profile without what the owner took out; the
     ledger still reads all of it, so a removed point is cut for being
     removed, not for being invented. */
  const writing: typeof context = {
    ...context,
    brandSummary: profileWithout(context.brandSummary, removed, free),
  };
  const system = buildSequenceSystemPrompt(
    writing.brandSummary,
    Boolean(context.brand?.logoUrl),
    { memorySummary, recentLayouts: input.recentLayouts },
  );

  const showImage =
    imageSource === "upload" &&
    image !== null &&
    image.bytes.byteLength <= ART_DIRECTOR_IMAGE_MAX_BYTES;
  let imageSeen = false;
  let imageRefused = false;

  async function askOnce<S extends z.ZodTypeAny>(
    schema: S,
    prompt: string,
    withImage: boolean,
    maxOutputTokens: number,
    count: number | undefined,
  ): Promise<z.infer<S>> {
    if (modelCalls >= MAX_MODEL_CALLS) throw new ModelBudgetError();
    modelCalls += 1;
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      system,
      maxOutputTokens,
      experimental_repairText: repairSequenceFor(count),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            ...(withImage && image
              ? [
                  {
                    type: "image" as const,
                    image: image.bytes,
                    mediaType: image.contentType,
                  },
                ]
              : []),
          ],
        },
      ],
    });
    return object as z.infer<S>;
  }

  /* An answer off the schema is asked for once more, as the directions
     call is; a photograph the provider refuses is dropped rather than the
     set, since seeing it only improves the copy, and is not sent again. */
  async function ask<S extends z.ZodTypeAny>(
    schema: S,
    buildPrompt: (attached: boolean) => string,
    maxOutputTokens: number,
    { count, looks = true }: { count?: number; looks?: boolean } = {},
  ): Promise<z.infer<S>> {
    const once = async (withImage: boolean) => {
      try {
        return await askOnce(
          schema,
          buildPrompt(withImage),
          withImage,
          maxOutputTokens,
          count,
        );
      } catch (err) {
        if ((err as Error)?.name !== "AI_NoObjectGeneratedError") throw err;
        /* The answer's text is the client's copy: its length says what
           went wrong without putting their brief in the log. */
        console.error(
          "sequence answer did not match the schema; asking again",
          {
            chars: String((err as { text?: unknown }).text ?? "").length,
          },
        );
        return askOnce(
          schema,
          buildPrompt(withImage),
          withImage,
          maxOutputTokens,
          count,
        );
      }
    };
    if (!looks || !showImage || imageRefused) return once(false);
    try {
      const answer = await once(true);
      imageSeen = true;
      return answer;
    } catch (err) {
      if (err instanceof ModelBudgetError) throw err;
      console.error(
        "sequence planner could not take the photograph",
        failure(err),
      );
      imageRefused = true;
      return once(false);
    }
  }

  const actionFacts = facts.filter(
    (f, n) => f.kind === "contact" || atAction.has(n),
  );
  const answered = await ask(
    arcResponseSchema(frameCount),
    (attached) =>
      buildArcPrompt(writing, {
        kind,
        frameCount,
        aspectRatio,
        pool,
        actionFacts: actionFacts.map((f) => f.text),
        offering,
        imageSource,
        imageAttached: attached,
        fixed: outline !== null,
      }),
    ARC_MAX_OUTPUT_TOKENS,
    { count: frameCount },
  );
  const arcAnswer = outline ? fixedArcAnswer(answered, outline) : answered;
  const arc = settleArc(arcAnswer, {
    pool,
    facts,
    kind,
    offeringFact: offeringIndex >= 0 ? offeringIndex : null,
    hasImage,
    recentLayouts: input.recentLayouts,
    free,
    atAction,
    fixed: outline !== null,
    actionClaim: outline?.points.at(-1)?.point ?? "",
  });
  const owners = arc.frames.map((f) => f.facts);
  const owned = ownedClaims(outline);
  const claimed: ClaimedFrame[] = arc.frames.map((f, i) => ({
    role: f.role,
    title: f.title,
    claim: f.claim,
    facts: f.facts.map((n) => facts[n].text),
    layout: f.layout,
    showsImage: f.showsImage,
    owned:
      ownedClaims(outline)[i] !== "" && ownedClaims(outline)[i] !== undefined,
  }));

  const askCopy = (second: boolean) =>
    ask(
      copyResponseSchema(frameCount),
      () =>
        buildArcCopyPrompt(writing, {
          kind,
          frames: claimed,
          offering,
          imageSource,
          aspectRatio,
          approved: outline !== null,
          removed: [...removedFromBrief(removedPool), ...released],
          second,
        }),
      COPY_MAX_OUTPUT_TOKENS,
      { count: frameCount },
    );
  /* Two drafts at once, so the second costs no wait. Either one is
     enough: the set fails only when both do. */
  const settled = await Promise.allSettled([askCopy(false), askCopy(true)]);
  const answers = settled.flatMap((r) => {
    if (r.status === "fulfilled") return [r.value];
    if (r.reason instanceof ModelBudgetError) throw r.reason;
    console.error("a sequence draft failed", failure(r.reason));
    return [];
  });
  if (answers.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const [copy, secondCopy = null] = answers;

  const ledger = sequenceLedger(context, memorySummary, stated);
  const profile = [
    ...profileStatements(writing.brandSummary),
    context.brandSummary.targetAudience?.trim() ?? "",
    ...stated,
  ].filter(Boolean);
  const titleRules: TitleRules = {
    sources: [
      briefText,
      ...stated,
      ...Object.values(context.brandSummary).filter(
        (v): v is string => typeof v === "string",
      ),
    ],
  };
  const rules: FaultRules = {
    frameCount,
    facts,
    offering,
    hasImage,
    brandName,
    names,
    ledger,
    owners,
    claims: arc.frames.map((f) => f.claim),
    titleSources: titleRules.sources,
    atAction,
    owned,
    removed,
    released,
    briefText,
  };
  const arcTitles = arc.frames.map((f) => [f.title]);
  const tidy = (frames: readonly FrameBeat[]) =>
    withSettledTitles(
      withoutRepeats(frames, facts, offering, owners),
      titleRules,
      arcTitles,
    );
  const drafts: Draft[] = [copy, secondCopy].flatMap((answer) => {
    if (!answer) return [];
    const written = assemblePlan(
      { kind, context },
      arcAnswer,
      arc.frames,
      answer,
    );
    return [
      {
        plan: { ...written, frames: tidy(written.frames) },
        hooks: [written.frames[0], ...answer.otherHooks],
      },
    ];
  });
  let pick: PickAnswer | null = null;
  if (drafts.length > 1) {
    try {
      pick = await ask(
        pickResponseSchema,
        () =>
          buildPickPrompt(writing, {
            kind,
            drafts: drafts.map((d) => d.plan.frames),
            hooks: drafts.flatMap((d) => d.hooks),
          }),
        PICK_MAX_OUTPUT_TOKENS,
        { looks: false },
      );
    } catch (err) {
      if (err instanceof ModelBudgetError) throw err;
      console.error(
        "sequence pick failed; keeping the first draft",
        failure(err),
      );
    }
  }
  const hooks = settlePick(
    drafts,
    pick ? { set: pick.set === "A" ? 0 : 1, hook: pick.hook - 1 } : null,
    rules,
  );
  let plan = hooks.plan;
  const draft = plan;

  let spares = sparePoints(arc, pool, facts, free);
  let unsourced: Flag[] = [];
  try {
    const audit = await ask(
      auditResponseSchema,
      () =>
        buildAuditPrompt(writing, {
          kind,
          frames: plan.frames,
          spares: spares.map((i) => ({ number: i + 1, text: pool[i].text })),
          profile,
        }),
      AUDIT_MAX_OUTPUT_TOKENS,
      { looks: false },
    );
    const flags = auditFlags(audit, plan.frames, ledger.text);
    rules.flagged = flags;
    unsourced = flags.filter((f) => f.kind === "unsourced");
    const fresh = new Set(audit.freshSpares.map((n) => n - 1));
    spares = spares.filter((i) => fresh.has(i));
  } catch (err) {
    if (err instanceof ModelBudgetError) throw err;
    console.error(
      "sequence audit failed; fixing on code's faults alone",
      failure(err),
    );
  }

  const fixRounds: { asked: number[]; kept: number[]; claims: number[] }[] = [];
  const fixRound = async (
    faults: readonly CopyFault[],
    swaps = new Map<number, string>(),
  ) => {
    const fixes = fixesFor(faults).map((fix) => ({
      ...fix,
      newClaim: swaps.get(fix.index) ?? null,
    }));
    if (fixes.length === 0) return;
    try {
      const answer = await ask(
        rewriteResponseSchema,
        () =>
          buildFixPrompt(writing, {
            kind,
            plan: plan.frames,
            frames: claimed,
            fixes,
            names,
          }),
        FIX_MAX_OUTPUT_TOKENS,
        { looks: false },
      );
      const applied = applyFixes(
        plan,
        answer.frames,
        new Set(fixes.map((f) => f.index)),
        rules,
        tidy,
      );
      plan = applied.plan;
      const swapped = fixes.filter(
        (f) => f.newClaim && applied.kept.includes(f.index),
      );
      for (const fix of swapped) {
        const claim = fix.newClaim ?? "";
        claimed[fix.index] = { ...claimed[fix.index], claim };
        arc.frames[fix.index] = { ...arc.frames[fix.index], claim };
        rules.claims = arc.frames.map((f) => f.claim);
      }
      fixRounds.push({
        asked: fixes.map((f) => f.index),
        kept: applied.kept,
        claims: swapped.map((f) => f.index),
      });
    } catch (err) {
      console.error("sequence fix call failed; keeping the copy", failure(err));
    }
  };

  const withSpares = async (faults: readonly CopyFault[]) => {
    const swaps = newClaims(plan, blockingFaults(faults), spares, pool);
    const taken = new Set(
      [...swaps.values()].map((claim) =>
        pool.findIndex((p) => p.text === claim),
      ),
    );
    await fixRound(faults, swaps);
    spares = spares.filter((i) => !taken.has(i));
  };
  const gate = () => {
    const result = shipGate(plan, {
      ...rules,
      claims: arc.frames.map((f) => f.claim),
      unsourced,
      spares: spares.map((i) => pool[i].text),
    });
    plan = result.plan;
    return result.applied;
  };
  await withSpares(setFaults(plan, rules));
  const gated = gate();
  const blocking = blockingFaults(setFaults(plan, rules));
  if (blocking.length > 0) {
    await withSpares(blocking);
    gated.push(...gate());
  }
  const casingSources = [
    briefText,
    context.title,
    brandName,
    offering,
    ...brandFacts(context.brandSummary),
    /* The owner's own points spell their names ("Kaduna and Jos"). */
    ...stated,
  ];
  const settle = (frames: readonly FrameBeat[]) =>
    withConsistentCasing(
      withSettledTitles(frames, titleRules, arcTitles),
      casingSources,
    );
  const drawFacts = () =>
    withFactsDrawn(
      plan,
      facts,
      owners,
      released,
      /* A when or where is every frame's to give, so it is drawn even
         beside words a removed point shared: "our Yaba bar" is the
         action's, whatever the owner did with "Specialty coffee bar in
         Yaba". */
      (line, frame, fact) =>
        !SAYABLE_KINDS.has(fact.kind) &&
        removedSaidBy(line, removed, arc.frames[frame]?.claim ?? "", free) !==
          null,
    );
  /* The other draft's frames and the openings both writers offered were
     written to the same claims: copy to try before code's plainest. */
  const alternates: AlternateCopy[][] = plan.frames.map((_, i) => [
    ...drafts.flatMap((d) => {
      const beat = d.plan.frames[i];
      return beat
        ? [
            {
              headline: beat.headline,
              subheadline: beat.subheadline,
              footerLines: beat.footerLines,
              cta: beat.cta,
            },
          ]
        : [];
    }),
    ...(i === 0
      ? drafts.flatMap((d) =>
          d.hooks.map((h) => ({
            headline: h.headline,
            subheadline: h.subheadline,
          })),
        )
      : []),
  ]);
  const finish = () => {
    const drawn = drawFacts();
    const settled = settle(drawn.plan.frames);
    plan = { ...drawn.plan, frames: settled.frames.map(withFigureLayout) };
    onLastResort?.({
      plan,
      rules,
      claims: arc.frames.map((f) => f.claim),
      alternates,
      titleRules,
      arcTitles,
      casingSources: casingSources.filter((s): s is string => Boolean(s)),
    });
    const result = lastResort(
      plan,
      rules,
      arc.frames.map((f) => f.claim),
      (frames) => settle(frames).frames.map(withFigureLayout),
      alternates,
    );
    plan = result.plan;
    return { drawn, settled, result };
  };
  let finished = finish();
  /* What code could not clear goes back to the model once, named, and is
     then settled again: a blocking fault is fixed before ship or the set
     is refused, never shipped. */
  if (finished.result.blocking.length > 0) {
    await withSpares(finished.result.blocking);
    gated.push(...gate());
    const again = finish();
    finished = {
      ...again,
      drawn: {
        ...again.drawn,
        drawn: [...finished.drawn.drawn, ...again.drawn.drawn],
      },
      result: {
        ...again.result,
        applied: [...finished.result.applied, ...again.result.applied],
      },
    };
  }
  const { drawn: filled, settled: cased, result: resorted } = finished;
  const refused = resorted.blocking.map((f) => ({
    frame: f.frame,
    detail: f.detail,
  }));
  const breached = resorted.breaches.length;

  const problems = validateSequence(plan, rules);
  const invented = unsourcedOnSet(plan.frames, { ledger, unsourced });
  const faults = setFaults(plan, rules);
  console.info("design.sequence.planned", {
    kind,
    frames: frameCount,
    facts: facts.length,
    pool: pool.map((p) => p.source),
    arc: arc.frames.map((f) => ({ point: f.point, claim: f.claim })),
    pointsReplaced: arc.replaced,
    angleDropped: arc.angleDropped,
    unsourced: arc.unsourced,
    crowded: arc.crowded,
    sameAs: [...arc.sameAs].filter((_, i) => i % 2 === 0),
    flagged: [...(rules.flagged ?? []), ...unsourced],
    layoutsChanged: arc.layoutsChanged,
    drafts: drafts.length,
    picked: {
      draft: hooks.draft,
      hook: hooks.hook,
      overruled: hooks.overruled,
    },
    fixRounds,
    gated,
    recased: cased.recased,
    problems: problems.map((p) => p.rule),
    invented,
    factsDrawn: filled.drawn,
    factsReleased: released,
    lastResort: resorted.applied,
    refused: refused.length,
    breaches: breached,
    faults: faults.map((f) => `frame ${f.frame + 1} ${f.field}: ${f.detail}`),
    imageSeen,
    readAvailable: brief.readAvailable,
    modelCalls,
    ms: Date.now() - started,
  });
  return {
    plan,
    facts,
    offering,
    problems,
    faults: faults.map((f) => ({ frame: f.frame, detail: f.detail })),
    invented,
    factsDrawn: filled.drawn,
    factsReleased: released,
    refused,
    lastResort: resorted.applied,
    modelCalls,
    repaired: copyKey(plan.frames) !== copyKey(draft.frames),
  };
}
