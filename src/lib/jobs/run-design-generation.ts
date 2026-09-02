import { generateObject } from "ai";
import { getNativeAdapters, getPlateAdapter } from "@/lib/ai/image";
import type { ImageAdapter } from "@/lib/ai/image/types";
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
import { readPngDimensions } from "@/lib/design/png-dimensions";
import { renderCompositeDesign } from "@/lib/design/render/composite";
import { type DesignSpec, designSpecSchema } from "@/lib/design/spec";
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

/** Fetches one reference image, from R2 by key where possible. */
async function loadImageBytes(
  logoUrl: string | null,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!logoUrl) return null;
  try {
    /* Our own storage only, and no arbitrary fetch fallback.
       logo_url and an attached asset's file_url are both user-writable, and
       this runs server-side inside a job — following whatever they contain
       would let a brand aim the renderer at a link-local metadata endpoint or
       any internal host and use the reply as a reference image.
       Every URL that legitimately reaches here was minted by publicUrl. */
    const key = storageKeyFrom(logoUrl, [
      STORAGE_PREFIXES.logos,
      STORAGE_PREFIXES.referenceImages,
    ]);
    if (!key) return null;
    const bytes = await getObjectBytes(key);
    return { bytes: new Uint8Array(bytes), contentType: "image/png" };
  } catch {
    // A missing image degrades the design; it must never fail the generation.
    return null;
  }
}

/** Brand logo first, then whatever the user attached, skipping any that fail. */
async function loadReferenceImages(
  logoUrl: string | null,
  attachedUrls: string[],
): Promise<{ bytes: Uint8Array; contentType: string }[]> {
  const loaded = await Promise.all(
    [logoUrl, ...attachedUrls].map((url) => loadImageBytes(url)),
  );
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
  logo: { bytes: Uint8Array; contentType: string } | null,
  /** Logo plus anything the user attached, for models that accept them. */
  references: { bytes: Uint8Array; contentType: string }[],
): Promise<{ bytes: Uint8Array; width?: number; height?: number }> {
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
    const result = await renderCompositeDesign({
      spec,
      brand: context.brand,
      plate,
      logo,
    });
    return {
      bytes: result.bytes,
      width: result.width,
      height: result.height,
    };
  }

  const image = await variant.adapter.generate({
    prompt: buildNativePrompt(
      spec,
      context.brandSummary,
      Boolean(logo) && variant.adapter.supportsReferenceImages,
    ),
    aspectRatio: spec.aspectRatio,
    ...(references.length > 0 && variant.adapter.supportsReferenceImages
      ? { referenceImages: references }
      : {}),
  });
  /* The model sized this one, so the size comes from the file rather than
     from us. Without it these rows store null and every surface guesses — so
     a failed read is logged rather than silently restoring that state. */
  const size = readPngDimensions(image.bytes);
  if (!size) {
    console.warn(
      `native image from ${variant.adapter.id} had no readable PNG size (${image.contentType}); storing without dimensions`,
    );
  }
  return { bytes: image.bytes, ...(size ?? {}) };
}

/**
 * Art-directs one design spec, then renders it through every configured route
 * so the user can compare. Each variant is an independent row that succeeds or
 * fails on its own — the job only fails if nothing rendered at all.
 */
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

  const { object: spec } = await generateObject({
    model: getModel("strategy"),
    schema: designSpecSchema,
    system: buildDesignSpecSystemPrompt(context.brandSummary),
    prompt: buildDesignSpecPrompt(context),
    maxOutputTokens: SPEC_MAX_OUTPUT_TOKENS,
  });

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

  const references = await loadReferenceImages(
    context.brand.logoUrl ?? null,
    context.referenceUrls,
  );
  // The first reference is the logo when there is one, which the composite
  // renderer overlays directly rather than handing to the model.
  const logo = context.brand.logoUrl ? (references[0] ?? null) : null;
  const succeeded: string[] = [];
  const failed: string[] = [];
  let done = 1;

  await Promise.all(
    variants.map(async (variant) => {
      try {
        const rendered = await renderVariant(
          variant,
          spec,
          context,
          logo,
          references,
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
        });
        succeeded.push(variant.id);
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
    },
  });

  return {
    resultId: succeeded[0],
    result: { generationIds: succeeded, failed, spec },
  };
}
