import { randomUUID } from "node:crypto";
import { freemem } from "node:os";
import { inferCategory } from "@/lib/ai/design-training/infer-category";
import { getPlateAdapter } from "@/lib/ai/image";
import { buildMemoryBlock } from "@/lib/ai/memory";
import type { DirectionsImageSource } from "@/lib/ai/prompts/design-directions";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import {
  createDesignGeneration,
  getDesignGenerationById,
  listDirectionSet,
  recordUsageEvent,
  updateDesignGeneration,
} from "@/lib/db/queries";
import type { DesignContext } from "@/lib/design/context";
import { prepareDocumentFonts } from "@/lib/design/document/rasterize";
import { markIsTooThin } from "@/lib/design/logo-placement";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import type { DesignSpec } from "@/lib/design/spec";
import { STORAGE_PREFIXES, uploadObject } from "@/lib/storage";
import { loadDesignImage } from "@/lib/uploads/design-image";
import { mapWithConcurrency } from "./calendar-assembly";
import { recentLayoutsFor, settleLogo } from "./design-logo-settle";
import { notifyBrandAssetFaults, notifyLogoLeftOff } from "./design-notify";
import { draftDirections, type PriorDirection } from "./directions/brief";
import { planConcepts, regenerationConcept } from "./directions/concepts";
import { renderConcurrency } from "./directions/concurrency";
import {
  type PlacedAsset,
  paintPlate,
  storeDrawnMark,
} from "./directions/imagery";
import { createStageReporter } from "./directions/progress";
import {
  type DirectionAssets,
  renderDirectionGuarded,
} from "./directions/render";
import {
  designSpecOf,
  readRationale,
  storedRationale,
} from "./directions/schema";
import type { JobRuntime } from "./run-generation";

export type DirectionsImage =
  | { source: "upload"; key: string }
  | { source: "ko" };

export interface DirectionsRequest {
  image: DirectionsImage;
  /** A direction to replace: exactly one new direction is made, in a layout
   *  that neither it nor its sibling uses. */
  regenerateOf?: string | null;
}

/** Thrown when the direction being regenerated is gone or not this brand's.
 *  The route checks first; this covers a delete between request and job. */
export class RegenerateTargetError extends Error {
  constructor() {
    super("The design you asked to regenerate no longer exists.");
    this.name = "RegenerateTargetError";
  }
}

interface RegenerationTarget {
  set: string;
  slot: number;
  /** The direction being replaced and its live sibling, when there is one. */
  existing: PriorDirection[];
}

type GenerationRow = NonNullable<
  Awaited<ReturnType<typeof getDesignGenerationById>>
>;

function priorDirection(row: GenerationRow): PriorDirection | null {
  const spec = row.spec as Partial<DesignSpec> | null;
  if (!spec?.headline || !spec.layout) return null;
  return {
    title: readRationale(row.rationale)?.title ?? spec.headline,
    headline: spec.headline,
    subheadline: spec.subheadline,
    cta: spec.cta,
    backgroundPrompt: spec.backgroundPrompt ?? "",
    layout: spec.layout,
  };
}

async function regenerationTarget(
  brandId: string,
  generationId: string,
): Promise<RegenerationTarget> {
  const target = await getDesignGenerationById(generationId);
  if (!target || target.brandId !== brandId) throw new RegenerateTargetError();
  const rationale = readRationale(target.rationale);
  /* A row made before directions existed has no set. It still gets a new
     direction that avoids its layout; it simply has no sibling to avoid. */
  if (!rationale?.set) {
    const prior = priorDirection(target);
    return {
      set: randomUUID(),
      slot: 0,
      existing: prior ? [prior] : [],
    };
  }
  /* Newest first, so a sibling that was itself regenerated is represented by
     its replacement, which is what the user is looking at. */
  const sibling = (await listDirectionSet(brandId, rationale.set)).find(
    (row) =>
      row.id !== target.id &&
      row.status === "succeeded" &&
      readRationale(row.rationale)?.slot !== rationale.slot,
  );
  return {
    set: rationale.set,
    slot: rationale.slot,
    existing: [target, sibling]
      .map((row) => (row ? priorDirection(row) : null))
      .filter((d): d is PriorDirection => d !== null),
  };
}

/**
 * The directions path (FEAT-033): two editable layer documents built on
 * contrasting concepts, or one replacement for a direction the user wants
 * again. Selected by the request's `image` field; see generateDesignWork.
 *
 * Order matters for cost and for what the user is left with on failure:
 *  1. The uploaded file is read and judged first, so an unusable image costs
 *     no model call and writes no row.
 *  2. One structured call writes every direction (directions/brief.ts).
 *  3. Rows are written before the slow work, as on the variant route, so
 *     provenance survives a crash.
 *  4. Imagery: the user's photograph as-is, or one stored plate per
 *     direction from the plate model.
 *  5. Each direction is rendered and passed through the pre-delivery gate,
 *     concurrently when memory allows.
 *
 * One quota unit per job however many directions it makes.
 */
export async function generateDirectionsWork(
  {
    context,
    userId,
    sessionId,
    request,
  }: {
    context: DesignContext;
    userId: string;
    sessionId?: string | null;
    request: DirectionsRequest;
  },
  runtime: JobRuntime,
): Promise<{ resultId?: string; result: unknown }> {
  const brandId = context.brand.id;
  const source: DirectionsImageSource = request.image.source;
  const regenerating = Boolean(request.regenerateOf);
  const count = regenerating ? 1 : 2;
  const stage = createStageReporter(runtime.reportProgress, count);
  stage(
    "brief",
    0,
    regenerating ? "Writing a new direction…" : "Writing two directions…",
  );

  const upload =
    request.image.source === "upload"
      ? {
          key: request.image.key,
          ...(await loadDesignImage(request.image.key, brandId)),
        }
      : null;
  const plateAdapter = source === "ko" ? getPlateAdapter() : null;
  if (source === "ko" && !plateAdapter) {
    throw new Error("Image generation is not configured.");
  }
  const target = request.regenerateOf
    ? await regenerationTarget(brandId, request.regenerateOf)
    : null;

  const category = inferCategory(context.briefText, context.designType);
  const [memorySummary, recent] = await Promise.all([
    buildMemoryBlock(brandId),
    recentLayoutsFor(brandId),
  ]);
  const brief = await draftDirections({
    context,
    imageSource: source,
    image: upload
      ? { bytes: new Uint8Array(upload.bytes), contentType: upload.contentType }
      : null,
    lenses: target ? [regenerationConcept(category)] : planConcepts(category),
    category,
    recentLayouts: recent,
    memorySummary,
    existing: target?.existing ?? [],
  });

  const settled = await Promise.all(
    brief.directions.map((d) => settleLogo(designSpecOf(d), context)),
  );
  const marks = await Promise.all(
    settled.map(async ({ logo }) =>
      logo
        ? { placed: await storeDrawnMark(brandId, logo), loaded: logo }
        : null,
    ),
  );

  const set = target?.set ?? randomUUID();
  const rows = await Promise.all(
    brief.directions.map((direction, i) =>
      createDesignGeneration({
        brandId,
        userId,
        source: context.source,
        briefId: context.briefId,
        calendarItemId: context.calendarItemId,
        attachments: context.attachments,
        designType: context.designType,
        spec: settled[i].spec,
        renderer: "composite",
        provider: plateAdapter?.id ?? "upload",
        model: plateAdapter?.model ?? "none",
        status: "pending",
        rationale: storedRationale(direction, set, target?.slot ?? i),
        imageSource: source,
        sourceImageKey: upload?.key ?? null,
      }),
    ),
  );

  let imageCalls = 0;
  let images: (PlacedAsset | null)[];
  if (upload) {
    const photo: PlacedAsset = {
      ref: { key: upload.key },
      asset: {
        bytes: new Uint8Array(upload.bytes),
        contentType: upload.contentType,
      },
    };
    images = settled.map(() => photo);
  } else {
    let painted = 0;
    stage("imagery", 0, "Creating imagery…");
    images = await Promise.all(
      settled.map(async ({ spec }) => {
        imageCalls += 1;
        const plate = await paintPlate({
          adapter: plateAdapter as NonNullable<typeof plateAdapter>,
          spec,
          brandId,
        });
        painted += 1;
        stage("imagery", painted, `Created ${painted} of ${count} images…`);
        return plate;
      }),
    );
  }

  const prepared = await prepareDocumentFonts(
    {
      brandFontUrl: context.brand.brandFontUrl,
      bodyFontUrl: context.brand.bodyFontUrl,
    },
    settled
      .flatMap(({ spec }) => [
        spec.headline,
        spec.subheadline,
        spec.cta,
        ...spec.footerLines,
      ])
      .filter(Boolean)
      .join(" "),
  );

  const largestImage = Math.max(
    0,
    ...images.map((image) => {
      const size = image ? readImageDimensions(image.asset.bytes) : null;
      return size ? size.width * size.height : 0;
    }),
  );
  const concurrency = renderConcurrency({
    directions: count,
    freeBytes: freemem(),
    imagePixels: largestImage,
  });

  const succeeded: string[] = [];
  const failed: string[] = [];
  const brandFontFaults: string[] = prepared.fault ? [prepared.fault] : [];
  const qualityFaults: string[] = [];
  const judgeVerdicts: string[] = [];
  const correctionsKept: string[] = [];
  const logoFaults: string[] = [];
  for (const { fault, logo } of settled) {
    if (fault) logoFaults.push(fault);
    if (logo && markIsTooThin(logo.aspect)) {
      logoFaults.push(
        "it is too long and thin to read at the size a corner allows — a stacked or compact version would place better",
      );
    }
  }
  for (const [i, mark] of marks.entries()) {
    if (mark && !mark.placed && settled[i].logo) {
      logoFaults.push("a copy of it could not be saved alongside the design");
    }
  }

  let rendered = 0;
  let checked = 0;
  stage(
    "render",
    0,
    `Rendering ${count === 1 ? "the direction" : "both directions"}…`,
  );
  const reportRendered = () => {
    rendered += 1;
    stage("render", rendered, `Rendered ${rendered} of ${count}…`);
    if (rendered === count) stage("checks", checked, "Checking the designs…");
  };
  const reportChecked = () => {
    checked += 1;
    if (rendered === count) {
      stage("checks", checked, `Checked ${checked} of ${count}…`);
    }
  };

  await mapWithConcurrency(rows, concurrency, async (row, i) => {
    let counted = false;
    try {
      const mark = marks[i];
      const assets: DirectionAssets = {
        image: images[i],
        logo: mark?.placed
          ? { placed: mark.placed, loaded: mark.loaded }
          : null,
      };
      /* A mark that loaded but could not be stored is not on the document,
         so the spec must not keep its corner either. */
      const spec = assets.logo
        ? settled[i].spec
        : { ...settled[i].spec, logoPlacement: "none" as const };
      const result = await renderDirectionGuarded({
        id: row.id,
        spec,
        context,
        assets,
        fonts: prepared,
        outOfTime: () => runtime.shouldPause(),
        onFirstRender: () => {
          counted = true;
          reportRendered();
        },
      });
      const key = `${STORAGE_PREFIXES.generated}/${brandId}/${randomUUID()}.png`;
      await uploadObject({ key, body: result.bytes, contentType: "image/png" });
      await updateDesignGeneration(row.id, {
        imageKey: key,
        status: "succeeded",
        width: result.width,
        height: result.height,
        document: result.document,
        /* The spec column is what layout memory and every later surface
           read, so it records what was drawn: the kept correction, and no
           corner for a mark that never made it onto the design. */
        spec: result.logoUnplaced
          ? { ...result.spec, logoPlacement: "none" as const }
          : result.spec,
      });
      succeeded.push(row.id);
      if (result.brandFontFault && !prepared.fault) {
        brandFontFaults.push(result.brandFontFault);
      }
      if (result.logoFault) logoFaults.push(result.logoFault);
      if (result.fault) qualityFaults.push(result.fault);
      if (result.correction) judgeVerdicts.push(result.correction);
      if (result.correctionKept) correctionsKept.push(row.id);
    } catch (err) {
      console.error(`design direction ${row.id} failed`, err);
      await updateDesignGeneration(row.id, {
        status: "failed",
        error:
          err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
      }).catch(() => {});
      failed.push(row.id);
      if (!counted) reportRendered();
    } finally {
      reportChecked();
    }
  });

  await notifyBrandAssetFaults(userId, {
    font: brandFontFaults,
    logo: logoFaults,
  });
  const leftOff = settled.find((s) => s.logoFree);
  if (leftOff && (context.brand.logoUrl || context.logoAssetUrls.length > 0)) {
    await notifyLogoLeftOff({
      userId,
      reason: leftOff.logoIsWhatWeAreDesigning
        ? `this is a ${context.designType} — the brand's current mark would be sitting on its own replacement`
        : `the brief asked for it: "${leftOff.spec.logoFreeQuote.trim()}"`,
    });
  }

  if (succeeded.length === 0) {
    throw new Error("Design generation failed. Please try again.");
  }

  /* Rows keep the order the directions were written in, so the results
     screen shows the "show" concept first whichever finished rendering
     first. */
  const generationIds = rows
    .map((row) => row.id)
    .filter((id) => succeeded.includes(id));

  /* One usage row is one quota unit (countDesignGenerationsForWorkspace), so
     two directions cost what one generation always has. */
  await recordUsageEvent({
    userId,
    brandId,
    kind: "design_generated",
    metadata: {
      generationIds,
      failed: failed.length,
      /* The cost outcome FEAT-033 names: on an upload no image model runs,
         and this is where that is visible per generation. */
      renderers: rows.map(() =>
        plateAdapter ? `composite:${plateAdapter.id}` : "composite:upload",
      ),
      imageCalls,
      imageSource: source,
      directions: generationIds.length,
      regenerateOf: request.regenerateOf ?? null,
      source: context.source,
      qualityFaults: qualityFaults.length,
      judgeVerdicts: judgeVerdicts.length,
      correctionsKept: correctionsKept.length,
      layoutsForced: brief.layoutsForced,
      redrafted: brief.redrafted,
      modelCalls: brief.modelCalls,
    },
  });

  const shared = {
    brand_id: brandId,
    session_id: sessionId ?? null,
    quality_faults: qualityFaults.length,
  };
  await captureServerEvent({
    distinctId: userId,
    event: "design_directions_generated",
    properties: {
      ...shared,
      source,
      directions: generationIds.length,
      regenerated: regenerating,
      image_calls: imageCalls,
      redrafted: brief.redrafted,
      layouts_forced: brief.layoutsForced,
    },
  });
  /* Kept for continuity: the quality-gate series on design_generated would
     otherwise read as a drop to zero the day the entry points switch over. */
  await captureServerEvent({
    distinctId: userId,
    event: "design_generated",
    properties: {
      ...shared,
      source: context.source,
      variants: generationIds.length,
      judge_verdicts: judgeVerdicts.length,
      corrections_kept: correctionsKept.length,
    },
  });

  return {
    resultId: generationIds[0],
    result: {
      generationIds,
      failed,
      imageSource: source,
      regenerateOf: request.regenerateOf ?? null,
    },
  };
}
