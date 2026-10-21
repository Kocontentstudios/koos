import { canvasFor } from "@/lib/design/canvas";
import type { DesignContext } from "@/lib/design/context";
import { checkRenderedDesign } from "@/lib/design/quality/checks";
import {
  betterResult,
  faultSummary,
  isCorrectable,
  isRetryable,
} from "@/lib/design/quality/gate";
import {
  correctionSummary,
  type DesignRenderer,
  judgeAndCorrect,
} from "@/lib/design/quality/judge";
import type { DesignSpec } from "@/lib/design/spec";

/**
 * The pre-delivery gate, independent of how a design is drawn (KOOS-AI-001
 * §1.6). Both the variant route (renderGuarded) and the directions route hand
 * it a render function; the checks, the single judge correction and the
 * keep-the-better rule live here once.
 */

/** What the gate needs from any render: the bytes, and whether the mark was
 *  measured unreadable or never placed at all. */
export interface GateRender {
  bytes: Uint8Array;
  logoFault?: string | null;
  logoUnplaced?: true;
}

export type Guarded<R extends GateRender> = R & {
  /** Faults still present on what is being delivered, in words. */
  fault?: string;
  /** The spec that produced the delivered bytes — the corrected one when the
   *  correction was kept. The row stores this, not the draft: the spec column
   *  is what every later surface reads, including the layout memory that
   *  shapes the brand's next design. */
  spec: DesignSpec;
  /** The verdict and the change, as one line for the log. Set whenever the
   *  judge answered, including when its prescription was refused. */
  correction?: string;
  /** The corrected render was the one delivered. Distinct from `correction`,
   *  which only says the judge spoke: counting the two as one measured a
   *  refused prescription and a discarded second render as successes. */
  correctionKept?: true;
};

export interface GateOptions {
  renderer: DesignRenderer;
  /** For the log only. */
  id: string;
  context: DesignContext;
  hasLogo: boolean;
  /** True once the slice's deadline has passed. A correction costs a reasoning
   *  call plus a second render, so past the deadline the user gets the design
   *  that exists rather than a better one that arrives after the function has
   *  been killed. */
  outOfTime?: () => boolean;
  /** Whether a corrected spec may be rendered. A caller with constraints the
   *  judge cannot see (two directions that must keep different layouts)
   *  refuses here, and the refusal is treated as no correction. */
  acceptCorrection?: (corrected: DesignSpec) => boolean;
  /** Whether rendering the same spec again can come out differently. True for
   *  image models; false for a deterministic render over a stored plate, where
   *  a re-roll only repeats the fault at the cost of a render. */
  rerollHelps?: boolean;
  /** Called once the first render exists, before it is checked. */
  onFirstRender?: () => void;
}

/**
 * Whether the mark was placed AND reads.
 *
 * `logoFault` has four producers and only one of them is a measurement: the
 * compositor comparing the mark against its own ground. The other three mean
 * the mark never reached the design — satori could not decode the file, the
 * image model returned a format the overlay cannot stamp, or the stamp threw.
 *
 * The distinction is load-bearing now that an unreadable mark is correctable.
 * A changed spec can move a placed mark to a corner that works; nothing in the
 * spec makes an undecodable file decodable. Conflating them would spend a
 * reasoning call and a full second image render, on every generation, for every
 * brand whose logo file we cannot read — and `checkRenderedDesign` would state
 * a pixel measurement that never happened.
 */
export function markReads(rendered: GateRender): boolean {
  return !rendered.logoFault || rendered.logoUnplaced === true;
}

/* The judge is an improvement to a design we are already holding, never a
   prerequisite for delivering it — the same rule buildMemoryBlock and
   recentLayoutsFor follow. It documents itself as fail-soft; this is the
   boundary that makes losing a rendered design impossible rather than
   unlikely. */
async function judgeOrSkip(
  args: Parameters<typeof judgeAndCorrect>[0],
): Promise<Awaited<ReturnType<typeof judgeAndCorrect>> | null> {
  try {
    return await judgeAndCorrect(args);
  } catch (err) {
    console.error("design judge unavailable", err);
    return null;
  }
}

/**
 * Render, check before anyone sees it, and correct once.
 *
 * Exactly one extra render, ever. What that render is given is the difference
 * this function exists for: the rubric judge (module 06 §10-11) sees the
 * failed design and prescribes one change, and the second render uses the
 * changed spec. A plain re-roll remains the fallback for the transient faults
 * where it genuinely helps and the judge could not be reached.
 *
 * A design that still fails is delivered with its fault recorded rather than
 * withheld: a flawed design the user can see and judge beats an error message
 * and nothing to look at.
 */
export async function guardRender<R extends GateRender>(
  render: (spec: DesignSpec) => Promise<R>,
  spec: DesignSpec,
  {
    renderer,
    id,
    context,
    hasLogo,
    outOfTime = () => false,
    acceptCorrection = () => true,
    rerollHelps = true,
    onFirstRender,
  }: GateOptions,
): Promise<Guarded<R>> {
  /* The canvas the spec asked for, which is what "the right shape" means here
     — not whatever the adapter decided to return. */
  const canvas = canvasFor(spec.aspectRatio);
  const first = await render(spec);
  onFirstRender?.();
  const firstCheck = checkRenderedDesign({
    bytes: first.bytes,
    expected: canvas,
    logoLegible: markReads(first),
  });
  if (firstCheck.ok) return { ...first, spec };

  console.error("design failed its pre-delivery checks", {
    variantId: id,
    renderer,
    faults: firstCheck.failures.map((f) => f.code),
  });

  const correctable = isCorrectable(firstCheck.failures);
  const retryable = rerollHelps && isRetryable(firstCheck.failures);
  if ((!correctable && !retryable) || outOfTime()) {
    return { ...first, spec, fault: faultSummary(firstCheck.failures) };
  }

  /* Reached only from a failure and only once per design — Oluwaseyi's
     decision on when the judge is worth paying for. */
  const judged = correctable
    ? await judgeOrSkip({
        spec,
        renderer,
        faults: firstCheck.failures,
        /* The pixels, when there are any to read. An unreadable mark is
           visible in them; unreadable bytes and a flat frame are not, and the
           judge degrades to the spec and the fault in words. */
        image: first.bytes,
        brief: context.briefText,
        brand: context.brandSummary,
        hasLogo,
      })
    : null;
  const correction = judged?.verdict ? correctionSummary(judged) : undefined;
  if (correction) {
    console.error("design judge", { variantId: id, correction });
  }
  const corrected = Boolean(
    judged?.corrected && judged.spec && acceptCorrection(judged.spec),
  );

  /* Nothing new to render: the judge found no change it could make (or one
     the caller refused), and this fault is not one a fresh roll of the same
     spec answers. */
  if (!corrected && !retryable) {
    return {
      ...first,
      spec,
      fault: faultSummary(firstCheck.failures),
      correction,
    };
  }

  const secondSpec = corrected && judged ? judged.spec : spec;
  const second = await render(secondSpec);
  const secondCheck = checkRenderedDesign({
    bytes: second.bytes,
    expected: canvas,
    logoLegible: markReads(second),
  });

  const keep = betterResult(firstCheck, secondCheck);
  const kept = keep === "first" ? first : second;
  const keptCheck = keep === "first" ? firstCheck : secondCheck;
  const keptSpec = keep === "first" ? spec : secondSpec;

  return {
    ...kept,
    spec: keptSpec,
    correction,
    ...(keep === "second" && corrected
      ? { correctionKept: true as const }
      : {}),
    ...(keptCheck.ok ? {} : { fault: faultSummary(keptCheck.failures) }),
  };
}
