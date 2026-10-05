import { generateObject } from "ai";
import {
  LAYOUT_MEMORY_DEPTH,
  recentLayouts,
} from "@/lib/ai/design-training/recent-layouts";
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
  createNotification,
  listDesignGenerationsForBrand,
  recordUsageEvent,
  updateDesignGeneration,
} from "@/lib/db/queries";
import { canvasFor } from "@/lib/design/canvas";
import type { DesignContext } from "@/lib/design/context";
import {
  briefAskedForNoLogo,
  logoIsTheDeliverable,
  markIsTooThin,
  resolveLogoPlacement,
} from "@/lib/design/logo-placement";
import { resolvePalette } from "@/lib/design/palette";
import { readImageDimensions } from "@/lib/design/png-dimensions";
import { checkRenderedDesign } from "@/lib/design/quality/checks";
import {
  betterResult,
  faultSummary,
  isCorrectable,
  isRetryable,
} from "@/lib/design/quality/gate";
import { correctionSummary, judgeAndCorrect } from "@/lib/design/quality/judge";
import { renderCompositeDesign } from "@/lib/design/render/composite";
import {
  LOGO_FILE_FAULTS,
  LOGO_UNDECODABLE_IN_RENDER,
  type LoadedLogo,
  loadBestLogo,
} from "@/lib/design/render/logo";
import { overlayLogo } from "@/lib/design/render/logo-overlay";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";
import { detectImageType } from "@/lib/images/detect";
import {
  getObjectBytes,
  STORAGE_PREFIXES,
  storageKeyFrom,
  uploadObject,
} from "@/lib/storage";
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
         and the original error stands. */
      if (!logo) throw err;
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

/* A design that rendered without the brand's own typeface or without its logo
   still looks finished, so nothing about the result itself tells the user what
   was dropped — they would just keep wondering why their brand never appears.

   The bell rather than the design row: the fault belongs to the brand asset,
   not to this one design, and it recurs on every future generation until the
   file is replaced. Deliberately not a failure — the design succeeded.

   One notification per fault kind per generation, not one per variant: every
   variant loads the same brand assets and would report the same fault. */
async function notifyAssetFault(userId: string, message: string) {
  await createNotification({
    userId,
    type: "system",
    payload: { message },
  }).catch((err) => {
    // A design that rendered must not be lost to a notification write.
    console.error("brand asset notification failed", err);
  });
}

/* Reasons that name the brand's own upload. Anything else is ours or the
   model's, and must not send the user to replace a file that is fine. */
const BRAND_FILE_FAULTS: ReadonlySet<string> = new Set(LOGO_FILE_FAULTS);

async function notifyLogoLeftOff({
  userId,
  reason,
}: {
  userId: string;
  reason: string;
}) {
  await notifyAssetFault(
    userId,
    `This design was made without your brand logo, because ${reason}. Generate it again without that instruction if the logo should be on it.`,
  );
}

async function notifyBrandAssetFaults(
  userId: string,
  faults: { font: string[]; logo: string[] },
) {
  const font = faults.font[0];
  if (font) {
    await notifyAssetFault(
      userId,
      /* Names the page, because until KOS-V1-FEAT-022 the only font upload
         was inside conversational onboarding and this sentence pointed at a
         control the user could not reach. */
      `Your brand font couldn't be used, so this design was set in the default typefaces instead: ${font}. Upload a replacement under Brand Fonts in Edit Brand.`,
    );
  }

  /* Distinct reasons, not the first one. A load fault and a per-variant stamp
     failure are different problems with different remedies, and reporting only
     whichever happened to land first tells the user to fix the wrong thing.
     Deduped because every variant loads the same file. */
  const reasons = [...new Set(faults.logo)];
  if (reasons.length > 0) {
    /* "Upload a replacement" only when the brand's file is actually the
       problem. A model that returned an image satori choked on is not
       something the user fixes by re-uploading a logo that is fine, and
       telling them so sends them round a loop that cannot end. */
    const theirFileIsAtFault = faults.logo.some((reason) =>
      BRAND_FILE_FAULTS.has(reason),
    );
    await notifyAssetFault(
      userId,
      `Your brand logo couldn't be added to this design because ${reasons.join("; and ")}.${
        theirFileIsAtFault
          ? " Upload a replacement under Logo in Edit Brand."
          : " Generating the design again usually clears it."
      }`,
    );
  }
}

/**
 * Art-directs one design spec, then renders it through every configured route
 * so the user can compare. Each variant is an independent row that succeeds or
 * fails on its own — the job only fails if nothing rendered at all.
 */
/**
 * Render a variant, check it before anyone sees it, and correct it once.
 *
 * The job's success criterion used to be "bytes were produced", and the faults
 * it did detect were raised after the image had been stored and shown. These
 * checks are deterministic and already existed offline; they now run before
 * delivery (KOOS-AI-001 §1.6).
 *
 * Exactly one extra render, ever. What that render is given is the difference
 * this function exists for: it used to be the identical spec, which is a dice
 * re-roll rather than a correction. The rubric judge (module 06 §10-11) now
 * sees the failed design and prescribes one change, and the second render uses
 * the changed spec. A plain re-roll remains the fallback for the transient
 * faults where it genuinely helps and the judge could not be reached.
 *
 * A design that still fails is delivered with its fault recorded rather than
 * withheld: a flawed design the user can see and judge beats an error message
 * and nothing to look at.
 */
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
function markReads(rendered: {
  logoFault?: string | null;
  logoUnplaced?: true;
}): boolean {
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

type GuardedRender = Awaited<ReturnType<typeof renderVariant>> & {
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

export async function renderGuarded(
  variant: DesignVariant,
  spec: DesignSpec,
  context: DesignContext,
  logo: LoadedLogo | null,
  references: { bytes: Uint8Array; contentType: string }[],
  /** True once the slice's deadline has passed. A correction costs a reasoning
   *  call plus a second image render, and this project has measured single
   *  images at 55-663s against a 300s route — so past the deadline the user
   *  gets the design that exists rather than a better one that arrives after
   *  the function has been killed. */
  outOfTime: () => boolean = () => false,
): Promise<GuardedRender> {
  /* The canvas the spec asked for, which is what "the right shape" means here
     — not whatever the adapter decided to return. */
  const canvas = canvasFor(spec.aspectRatio);
  const first = await renderVariant(variant, spec, context, logo, references);
  const firstCheck = checkRenderedDesign({
    bytes: first.bytes,
    expected: canvas,
    logoLegible: markReads(first),
  });
  if (firstCheck.ok) return { ...first, spec };

  console.error("design failed its pre-delivery checks", {
    variantId: variant.id,
    renderer: variant.renderer,
    faults: firstCheck.failures.map((f) => f.code),
  });

  const correctable = isCorrectable(firstCheck.failures);
  const retryable = isRetryable(firstCheck.failures);
  if ((!correctable && !retryable) || outOfTime()) {
    return { ...first, spec, fault: faultSummary(firstCheck.failures) };
  }

  /* Reached only from a failure and only once per variant — Oluwaseyi's
     decision on when the judge is worth paying for. */
  const judged = correctable
    ? await judgeOrSkip({
        spec,
        renderer: variant.renderer,
        faults: firstCheck.failures,
        /* The pixels, when there are any to read. An unreadable mark is
           visible in them; unreadable bytes and a flat frame are not, and the
           judge degrades to the spec and the fault in words. */
        image: first.bytes,
        brief: context.briefText,
        brand: context.brandSummary,
        hasLogo: Boolean(logo),
      })
    : null;
  const correction = judged?.verdict ? correctionSummary(judged) : undefined;
  if (correction) {
    console.error("design judge", { variantId: variant.id, correction });
  }

  /* Nothing new to render: the judge found no change it could make, and this
     fault is not one a fresh roll of the same spec answers. */
  if (!judged?.corrected && !retryable) {
    return {
      ...first,
      spec,
      fault: faultSummary(firstCheck.failures),
      correction,
    };
  }

  const secondSpec = judged?.corrected ? judged.spec : spec;
  const second = await renderVariant(
    variant,
    secondSpec,
    context,
    logo,
    references,
  );
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
    ...(keep === "second" && judged?.corrected
      ? { correctionKept: true as const }
      : {}),
    ...(keptCheck.ok ? {} : { fault: faultSummary(keptCheck.failures) }),
  };
}

/* Layout history is an improvement to the brief, never a prerequisite for it.
   buildMemoryBlock already swallows its own failures; this read has to do the
   same, or an unavailable history would cost the user their design. */
async function recentLayoutsFor(brandId: string): Promise<string[]> {
  try {
    return recentLayouts(
      await listDesignGenerationsForBrand(brandId, {
        limit: LAYOUT_MEMORY_DEPTH,
      }),
    );
  } catch (err) {
    console.error("recent layout history unavailable", err);
    return [];
  }
}

export async function generateDesignWork(
  args: {
    context: DesignContext;
    userId: string;
    sessionId?: string | null;
  },
  runtime: JobRuntime,
): Promise<{ resultId?: string; result: unknown }> {
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

  /* The model's answer is trusted only where the brief could plausibly have
     asked. Otherwise logoFree is the old "none" escape hatch wearing a new
     name: one hallucinated true and the mark is gone with no fault, no
     notification and nothing in the UI to say why. */
  const logoIsWhatWeAreDesigning = logoIsTheDeliverable(context.designType);
  const briefAsked =
    drafted.logoFree &&
    briefAskedForNoLogo(context.briefText, drafted.logoFreeQuote);
  const logoFree = logoIsWhatWeAreDesigning || briefAsked;

  /* The logo is loaded before the rows are written because placement depends
     on whether the file is actually usable, and the spec is persisted with
     those rows — a stored spec that disagrees with what was rendered is worse
     than no spec at all. Skipped entirely for a logo-free brief: an R2 read
     and an SVG rasterise to decide not to draw it, and a load fault the user
     could do nothing useful with. */
  const { logo, fault: logoLoadFault } = logoFree
    ? { logo: null, fault: null }
    : await loadBestLogo({
        /* The profile logo plus every other approved mark, ordered so the
           user's chosen default wins when two read equally well — loadBestLogo
           measures contrast and keeps the first on a tie (FEAT-032). */
        urls: context.logoCandidates,
        /* The resolved palette, not the model's raw string: colorValue is a
           permissive z.string() on purpose, so the model routinely answers
           with a colour NAME and resolvePalette substitutes the brand's own
           colour downstream. Comparing against the raw value picks the variant
           for a background that is never rendered. */
        background: resolvePalette(drafted.palette, context.brand).background,
      });

  /* Whether the brand's own mark appears is not the art director's call.
     "none" is in the enum and the prompt gave it no grounds to choose it, so
     it chose it routinely and the logo silently vanished (KOOS-BUG-022). */
  const spec: DesignSpec = {
    ...drafted,
    /* The resolved answer, not the model's raw claim. A brief where the
       quotation was not corroborated used to persist logoFree: true beside a
       real corner — a stored spec disagreeing with the render, which is the
       invariant this file defends everywhere else. */
    logoFree,
    logoFreeQuote: logoFree ? drafted.logoFreeQuote : "",
    logoPlacement: resolveLogoPlacement({
      modelChoice: drafted.logoPlacement,
      hasLogo: Boolean(logo),
      layout: drafted.layout,
      logoFree,
      /* A footer band covers the bottom corners, so the mark has to move off
         them before placement rather than being measured as illegible after. */
      footer: {
        footerStyle: drafted.footerStyle,
        footerLines: drafted.footerLines,
      },
    }),
  };

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
    throw new Error("Design generation failed. Please try again.");
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
