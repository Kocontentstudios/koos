import { generateObject } from "ai";
import { getNativeAdapters, getPlateAdapter } from "@/lib/ai/image";
import type { ImageAdapter } from "@/lib/ai/image/types";
import { buildMemoryBlock } from "@/lib/ai/memory";
import {
  buildBackgroundPlatePrompt,
  buildDesignSpecPrompt,
  buildDesignSpecSystemPrompt,
  buildNativePrompt,
} from "@/lib/ai/prompts/design-spec";
import { getModel } from "@/lib/ai/provider";
import { captureServerEvent } from "@/lib/analytics/posthog-server";
import {
  createDesignGeneration,
  recordUsageEvent,
  updateDesignGeneration,
} from "@/lib/db/queries";
import type { DesignContext } from "@/lib/design/context";
import {
  KoImageryDisabledError,
  koImageryEnabled,
} from "@/lib/design/ko-imagery-flag";
import { markIsTooThin } from "@/lib/design/logo-placement";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import { renderCompositeDesign } from "@/lib/design/render/composite";
import {
  LOGO_UNDECODABLE_IN_RENDER,
  type LoadedLogo,
} from "@/lib/design/render/logo";
import { overlayLogo } from "@/lib/design/render/logo-overlay";
import {
  EmojiBudgetError,
  RenderTimeoutError,
} from "@/lib/design/render/satori-pool";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";
import { detectImageType } from "@/lib/images/detect";
import {
  getObjectBytes,
  STORAGE_PREFIXES,
  storageKeyFrom,
  uploadObject,
} from "@/lib/storage";
import { type Guarded, guardRender } from "./design-gate";
import { recentLayoutsFor, settleLogo } from "./design-logo-settle";
import { notifyBrandAssetFaults, notifyLogoLeftOff } from "./design-notify";
import {
  type DirectionsRequest,
  generateDirectionsWork,
} from "./run-design-directions";
import type { JobRuntime } from "./run-generation";

/** Bedrock's 4096 default truncates structured output mid-JSON, which surfaces
 * as an unhelpful schema-mismatch retry loop rather than a length error. */
const SPEC_MAX_OUTPUT_TOKENS = 4000;

interface DesignVariant {
  id: string;
  renderer: "composite" | "native";
  adapter: ImageAdapter;
}

/** Fetches one image the user attached, from R2 by key where possible. */
async function loadImageBytes(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  try {
    /* Our own storage only, and no arbitrary fetch fallback.
       An attached asset's file_url is user-writable and this runs server-side
       inside a job — following whatever it contains would let a brand aim the
       renderer at a link-local metadata endpoint or any internal host and use
       the reply as a reference image.
       Every URL that legitimately reaches here was minted by publicUrl. */
    const key = storageKeyFrom(url, [
      STORAGE_PREFIXES.logos,
      STORAGE_PREFIXES.referenceImages,
    ]);
    if (!key) return null;
    const bytes = await getObjectBytes(key);
    return { bytes: new Uint8Array(bytes), contentType: "image/png" };
  } catch {
    // A missing attachment degrades the design; it must never fail it.
    return null;
  }
}

/**
 * What the user attached, and nothing else.
 *
 * The brand logo is loaded separately by loadBrandLogo. It used to share this
 * list and be recovered as `references[0]`, which was only the logo while the
 * logo loaded: a brand whose logo failed but who had attached a reference got
 * that reference stamped into the logo slot (KOOS-BUG-022).
 */
async function loadAttachedImages(
  urls: string[],
): Promise<{ bytes: Uint8Array; contentType: string }[]> {
  const loaded = await Promise.all(urls.map((url) => loadImageBytes(url)));
  return loaded.filter(
    (image): image is { bytes: Uint8Array; contentType: string } =>
      image !== null,
  );
}

function planVariants(): {
  renderer: "composite" | "native";
  adapter: ImageAdapter;
}[] {
  const plan: { renderer: "composite" | "native"; adapter: ImageAdapter }[] =
    [];
  const plate = getPlateAdapter();
  if (plate) plan.push({ renderer: "composite", adapter: plate });
  for (const adapter of getNativeAdapters()) {
    plan.push({ renderer: "native", adapter });
  }
  return plan;
}

/* Exported for the test that pins the native size read — the wiring is the
   only place readPngDimensions takes effect, and it is invisible from the
   outside once a row is written. */
export async function renderVariant(
  variant: DesignVariant,
  spec: DesignSpec,
  context: DesignContext,
  logo: LoadedLogo | null,
  /** Only what the user attached. The logo is never in here — see
   *  loadAttachedImages. */
  references: { bytes: Uint8Array; contentType: string }[],
): Promise<{
  bytes: Uint8Array;
  width?: number;
  height?: number;
  /** Set when the brand's own face could not be used and the design fell back
   *  to the bundled ones, so the caller can tell the user rather than leave
   *  them wondering why their typeface never appears. */
  brandFontFault?: string | null;
  /** Set when the logo was loaded but could not be placed on this variant. */
  logoFault?: string | null;
  /** Set when this design carries no mark at all, as opposed to one that was
   *  placed and measured hard to read. Only the measured case is a contrast
   *  problem a different spec could answer — see markReads. */
  logoUnplaced?: true;
}> {
  if (variant.renderer === "composite") {
    // A failed plate still yields a design: the layout falls back to a flat
    // brand-coloured background rather than losing the variant entirely.
    let plate: { bytes: Uint8Array; contentType: string } | null = null;
    try {
      plate = await variant.adapter.generate({
        prompt: buildBackgroundPlatePrompt(spec),
        aspectRatio: spec.aspectRatio,
      });
    } catch (err) {
      console.error("design plate generation failed, rendering flat", err);
    }
    const compose = (withLogo: LoadedLogo | null) =>
      renderCompositeDesign({
        spec,
        brand: context.brand,
        plate,
        logo: withLogo,
      });

    let result: Awaited<ReturnType<typeof renderCompositeDesign>>;
    let logoFault: string | null = null;
    try {
      result = await compose(logo);
    } catch (err) {
      /* A logo satori cannot decode takes the whole design down with it, and
         the user loses a render rather than a corner. Retrying without it
         proves whether the mark was the cause: if the second pass succeeds the
         logo was, and the user is told; if it fails too the fault is elsewhere
         and the original error stands. A render stopped at its time limit
         is not the logo's doing, and a second try would hold the render
         pool for the whole limit again; nor is copy with more emoji than a
         render may fetch. */
      if (
        !logo ||
        err instanceof RenderTimeoutError ||
        err instanceof EmojiBudgetError
      ) {
        throw err;
      }
      result = await compose(null).catch(() => {
        throw err;
      });
      logoFault = LOGO_UNDECODABLE_IN_RENDER;
    }

    return {
      bytes: result.bytes,
      width: result.width,
      height: result.height,
      brandFontFault: result.brandFontFault,
      logoFault: logoFault ?? result.logoFault,
      /* This design carries no mark at all, as opposed to one that was placed
         and measured hard to read. Only the measured case is a contrast
         problem a different spec could answer. */
      ...(logoFault ? { logoUnplaced: true as const } : {}),
    };
  }

  /* The logo is deliberately NOT handed to the model. A text-capable model
     redraws a reference image rather than reproducing it — approximating the
     letterforms, flattening the alpha and reshaping the mark — so it is asked
     to leave the corner clear and the real file is composited afterwards. */
  const image = await variant.adapter.generate({
    prompt: buildNativePrompt(spec, context.brandSummary),
    aspectRatio: spec.aspectRatio,
    ...(references.length > 0 && variant.adapter.supportsReferenceImages
      ? { referenceImages: references }
      : {}),
  });
  /* The model sized this one, so the size comes from the file rather than
     from us. Without it these rows store null and every surface guesses — so
     a failed read is logged rather than silently restoring that state. */
  const size = readImageDimensions(image.bytes);
  if (!size) {
    console.warn(
      `native image from ${variant.adapter.id} had no readable size (${image.contentType}); storing without dimensions`,
    );
  }

  if (!logo || spec.logoPlacement === "none") {
    return { bytes: image.bytes, ...(size ?? {}) };
  }

  /* Sniffed, not taken from the adapter's declared mediaType, and checked
     before the stamp rather than after it throws. satori reads PNG and JPEG;
     handed a WEBP it fails deep inside with "u2 is not iterable", which the
     catch below would have reported as a problem with the brand's logo file —
     sending the user to replace a logo that is fine, on every generation from
     that model. */
  const rendered = detectImageType(image.bytes);
  const composable = rendered === "png" || rendered === "jpeg";
  /* The overlay canvas has to match the image it is stamping or object-fit
     crops the design, and falling back to OUR canvas silently downscales a 2K
     render. No true size, no stamp. */
  const canvas = composable ? readImageDimensions(image.bytes) : null;
  if (!canvas) {
    console.warn(
      `native image from ${variant.adapter.id} came back as ${rendered ?? image.contentType}; skipping the logo overlay`,
    );
    return {
      bytes: image.bytes,
      ...(size ?? {}),
      /* Names the model, not the brand's file: re-uploading the logo would
         change nothing here. */
      logoFault: `this version came back from the image model in a format the design renderer cannot stamp (${rendered ?? image.contentType})`,
      logoUnplaced: true as const,
    };
  }

  try {
    const stamped = await overlayLogo({
      image,
      logo,
      placement: spec.logoPlacement,
      layout: spec.layout,
      canvas,
    });
    return {
      bytes: stamped.bytes,
      width: canvas.width,
      height: canvas.height,
      logoFault: stamped.logoFault,
    };
  } catch (err) {
    /* A design that rendered must not be lost to the stamp. The user gets the
       model's own composition and is told the logo did not make it. */
    console.error("logo overlay failed, keeping the unstamped design", err);
    return {
      bytes: image.bytes,
      ...(size ?? {}),
      logoFault: "the design renderer could not place it on this version",
      logoUnplaced: true as const,
    };
  }
}

export type GuardedRender = Guarded<Awaited<ReturnType<typeof renderVariant>>>;

/** A variant through the pre-delivery gate (design-gate.ts). */
export function renderGuarded(
  variant: DesignVariant,
  spec: DesignSpec,
  context: DesignContext,
  logo: LoadedLogo | null,
  references: { bytes: Uint8Array; contentType: string }[],
  outOfTime: () => boolean = () => false,
): Promise<GuardedRender> {
  return guardRender(
    (attempt) => renderVariant(variant, attempt, context, logo, references),
    spec,
    {
      renderer: variant.renderer,
      id: variant.id,
      context,
      hasLogo: Boolean(logo),
      outOfTime,
    },
  );
}

/**
 * What the user is told when no variant rendered. The composite path never
 * runs the schema's emoji count, so copy with too many emoji reaches the
 * render worker's budget and every variant is refused; trying again would
 * fail the same way, so the message says what to change. Only when every
 * failure was the emoji: a variant down for another reason (an outage) must
 * not be hidden behind it.
 */
export function designFailureMessage(failures: unknown[]): string {
  const emoji = failures.find((f) => f instanceof EmojiBudgetError);
  if (emoji && failures.every((f) => f instanceof EmojiBudgetError)) {
    return `This design can't be drawn: ${(emoji as EmojiBudgetError).message}, then try again.`;
  }
  return "Design generation failed. Please try again.";
}

/**
 * Art-directs one design spec, then renders it through every configured route
 * so the user can compare. Each variant is an independent row that succeeds or
 * fails on its own — the job only fails if nothing rendered at all.
 *
 * A request carrying `directions` (an image choice) takes the two-directions
 * path instead (run-design-directions.ts). Without one it runs only while
 * FEATURE_KO_IMAGERY is on.
 */
export async function generateDesignWork(
  args: {
    context: DesignContext;
    userId: string;
    sessionId?: string | null;
    directions?: DirectionsRequest;
  },
  runtime: JobRuntime,
): Promise<{ resultId?: string; result: unknown }> {
  if (args.directions) {
    return generateDirectionsWork(
      {
        context: args.context,
        userId: args.userId,
        sessionId: args.sessionId,
        request: args.directions,
      },
      runtime,
    );
  }
  /* The variant path paints a KO plate or a native image on every run, so it
     sits behind the same flag as KO imagery. Checked here as well as in the
     route so a caller that enqueues the job directly cannot reach the model. */
  if (!koImageryEnabled()) throw new KoImageryDisabledError();
  const { context, userId } = args;
  const plan = planVariants();
  if (plan.length === 0) {
    throw new Error("Image generation is not configured.");
  }

  const total = plan.length + 1;
  runtime.reportProgress({
    done: 0,
    total,
    label: "Art-directing your design…",
  });

  const { object: drafted } = await generateObject({
    model: getModel("strategy"),
    schema: designSpecSchema,
    system: buildDesignSpecSystemPrompt(
      context.brandSummary,
      Boolean(context.brand.logoUrl),
      /* Both are best-effort improvements to the brief, not prerequisites
         for it: a brand with no chat history has no memory, and one
         generating its first design has no layout history. */
      {
        memorySummary: await buildMemoryBlock(context.brand.id),
        recentLayouts: await recentLayoutsFor(context.brand.id),
      },
    ),
    prompt: buildDesignSpecPrompt(context),
    maxOutputTokens: SPEC_MAX_OUTPUT_TOKENS,
  });

  const {
    spec,
    logo,
    fault: logoLoadFault,
    logoFree,
    logoIsWhatWeAreDesigning,
  } = await settleLogo(drafted, context);

  // Rows are created before the slow calls so provenance survives a crash and
  // the client can render skeleton cards immediately.
  const variants: DesignVariant[] = [];
  for (const entry of plan) {
    const row = await createDesignGeneration({
      brandId: context.brand.id,
      userId,
      source: context.source,
      briefId: context.briefId,
      calendarItemId: context.calendarItemId,
      // The source enum records one primary reference; this is the full list
      // the user actually attached.
      attachments: context.attachments,
      designType: context.designType,
      spec,
      renderer: entry.renderer,
      provider: entry.adapter.id,
      model: entry.adapter.model,
      status: "pending",
    });
    variants.push({ id: row.id, ...entry });
  }

  runtime.reportProgress({
    done: 1,
    total,
    label: `Rendering ${variants.length} version${variants.length === 1 ? "" : "s"}…`,
  });

  /* An attachment that IS the brand logo would be redrawn by the model beside
     the file we stamp, and two marks read as deliberate. The user attaching
     their own logo as a reference is the realistic path — the context picker
     offers brand assets by name. */
  /* Compared as storage keys, not as strings: the same object reaches this
     list through different URLs — a query string, a different percent-encoding
     — and a string compare lets it past, so the model redraws the mark AND the
     real file is stamped over it. */
  const logoKey = storageKeyFrom(context.brand.logoUrl, STORAGE_PREFIXES.logos);
  const references = await loadAttachedImages(
    context.referenceUrls.filter(
      (url) =>
        !logoKey ||
        storageKeyFrom(url, [
          STORAGE_PREFIXES.logos,
          STORAGE_PREFIXES.referenceImages,
        ]) !== logoKey,
    ),
  );
  const succeeded: string[] = [];
  const failures: unknown[] = [];
  const failed: string[] = [];
  const brandFontFaults: string[] = [];
  /* The pre-delivery gate's findings were computed and dropped. Without these
     counts there is no way to tell whether the judge is correcting anything or
     only costing a call — and a single count would not separate the two, since
     a verdict arrives on every refused prescription too. */
  const qualityFaults: string[] = [];
  const judgeVerdicts: string[] = [];
  const correctionsKept: string[] = [];
  const logoFaults: string[] = logoLoadFault ? [logoLoadFault] : [];
  /* An extremely elongated mark is placed correctly and is still unreadable at
     the size a corner allows. Reported once, not per variant. */
  if (logo && markIsTooThin(logo.aspect)) {
    logoFaults.push(
      "it is too long and thin to read at the size a corner allows — a stacked or compact version would place better",
    );
  }
  let done = 1;

  await Promise.all(
    variants.map(async (variant) => {
      try {
        const rendered = await renderGuarded(
          variant,
          spec,
          context,
          logo,
          references,
          () => runtime.shouldPause(),
        );
        const key = `${STORAGE_PREFIXES.generated}/${context.brand.id}/${crypto.randomUUID()}.png`;
        await uploadObject({
          key,
          body: rendered.bytes,
          contentType: "image/png",
        });
        await updateDesignGeneration(variant.id, {
          imageKey: key,
          status: "succeeded",
          width: rendered.width ?? null,
          height: rendered.height ?? null,
          /* The row is written before rendering, so it holds the draft spec.
             It is replaced when what actually rendered differs: the judge's
             corrected spec when that render was the one kept, or a dropped
             mark that must stop claiming a corner it does not have. The spec
             column is what every later surface reads, including the layout
             memory that shapes this brand's next design, so a spec that was
             never rendered would teach it a layout nobody saw. */
          ...(rendered.logoFault
            ? { spec: { ...rendered.spec, logoPlacement: "none" as const } }
            : rendered.spec !== spec
              ? { spec: rendered.spec }
              : {}),
        });
        succeeded.push(variant.id);
        if (rendered.brandFontFault) {
          brandFontFaults.push(rendered.brandFontFault);
        }
        if (rendered.logoFault) logoFaults.push(rendered.logoFault);
        if (rendered.fault) qualityFaults.push(rendered.fault);
        if (rendered.correction) judgeVerdicts.push(rendered.correction);
        if (rendered.correctionKept) correctionsKept.push(variant.id);
      } catch (err) {
        failures.push(err);
        console.error(`design variant ${variant.id} failed`, err);
        await updateDesignGeneration(variant.id, {
          status: "failed",
          error:
            err instanceof Error ? err.message.slice(0, 500) : "Unknown error",
        }).catch(() => {});
        failed.push(variant.id);
      } finally {
        done += 1;
        runtime.reportProgress({ done, total, label: "Rendering designs…" });
      }
    }),
  );

  /* Before the throw, not after it. A brand whose logo cannot be loaded and
     whose variants then all fail is exactly the case that most needs telling,
     and it was the one case that said nothing. */
  await notifyBrandAssetFaults(userId, {
    font: brandFontFaults,
    logo: logoFaults,
  });

  /* An omission the user did not intend looks exactly like the bug this whole
     change is about: the logo is simply not there. Saying so is what makes a
     wrong reading of the brief correctable instead of invisible — and no
     textual guard can settle whether a sentence asked for removal, so being
     loud matters more than being clever. */
  if (logoFree && (context.brand.logoUrl || context.logoAssetUrls.length > 0)) {
    await notifyLogoLeftOff({
      userId,
      reason: logoIsWhatWeAreDesigning
        ? `this is a ${context.designType} — the brand's current mark would be sitting on its own replacement`
        : `the brief asked for it: "${drafted.logoFreeQuote.trim()}"`,
    });
  }

  if (succeeded.length === 0) {
    throw new Error(designFailureMessage(failures));
  }

  // Closes the metering gap the old generate-image route left open: image
  // generation was previously the only AI feature with no usage row at all.
  await recordUsageEvent({
    userId,
    brandId: context.brand.id,
    kind: "design_generated",
    metadata: {
      generationIds: succeeded,
      failed: failed.length,
      renderers: variants.map((v) => `${v.renderer}:${v.adapter.id}`),
      source: context.source,
      /* Also on the usage row, because captureServerEvent is a no-op without a
         PostHog key and the admin dashboard reads Postgres. */
      qualityFaults: qualityFaults.length,
      judgeVerdicts: judgeVerdicts.length,
      correctionsKept: correctionsKept.length,
    },
  });

  await captureServerEvent({
    distinctId: userId,
    event: "design_generated",
    properties: {
      brand_id: context.brand.id,
      source: context.source,
      variants: succeeded.length,
      session_id: args.sessionId ?? null,
      /* The measurable outcome for KOOS-AI-001's quality gate. Three numbers,
         not one: how often a design reached delivery still carrying a fault,
         how often the judge answered at all, and how often its correction was
         the version actually delivered. judge_verdicts minus corrections_kept
         is the cost of verdicts that bought nothing. */
      quality_faults: qualityFaults.length,
      judge_verdicts: judgeVerdicts.length,
      corrections_kept: correctionsKept.length,
    },
  });

  return {
    resultId: succeeded[0],
    result: { generationIds: succeeded, failed, spec },
  };
}
