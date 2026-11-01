import { after } from "next/server";
import { resolveDesignProviders } from "@/lib/ai/image";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import {
  checkBrandAccess,
  createGenerationJob,
  getDesignGenerationById,
} from "@/lib/db/queries";
import { DesignContextError, resolveDesignContext } from "@/lib/design/context";
import { readRationale } from "@/lib/design/direction-rationale";
import {
  KoImageryDisabledError,
  koImageryEnabled,
} from "@/lib/design/ko-imagery-flag";
import { multiFrameEnabled } from "@/lib/design/multi-frame-flag";
import { checkDesignQuota, quotaExceeded } from "@/lib/design/quota";
import {
  type DesignContextBody,
  parseContextFields,
  parseFrames,
} from "@/lib/design/request-fields";
import {
  type ApprovedOutline,
  clampFrameCount,
  sequenceKindOf,
} from "@/lib/design/sequence/contract";
import { validateApprovedOutline } from "@/lib/design/sequence/outline-validate";
import { profileStatements } from "@/lib/design/sequence/points";
import type { DirectionsImage } from "@/lib/jobs/run-design-directions";
import { generateDesignWork } from "@/lib/jobs/run-design-generation";
import { executeGenerationJob } from "@/lib/jobs/run-generation";
import { SEQUENCE_SLICE_BUDGET_MS } from "@/lib/jobs/stale";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isStorageConfigured } from "@/lib/storage";
import {
  DesignImageError,
  isDesignImageKeyFor,
} from "@/lib/uploads/design-image";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for the post-response generation work kicked off via after().
export const maxDuration = 300;

/**
 * The image choice that selects the two-directions path. Undefined when the
 * caller sent none (the flag-gated variant path), null when it is malformed.
 * Which brand the key belongs to is checked once the brand row is known.
 */
function parseImage(value: unknown): DirectionsImage | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== "object") return null;
  const { source, key } = value as Record<string, unknown>;
  if (source === "ko") return { source: "ko" };
  if (source === "none") return { source: "none" };
  if (source === "upload" && typeof key === "string" && key.length <= 512) {
    return { source: "upload", key };
  }
  return null;
}

function paintsWithKo(image: DirectionsImage | undefined): boolean {
  return image === undefined || image.source === "ko";
}

/**
 * Turns brand + brief/calendar/free-form context into rendered design variants
 * as an async job: returns 202 + jobId immediately; the client polls
 * /api/jobs/[id] and picks a variant to download or send to the design team.
 */
export async function POST(req: Request) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

  const verdict = await checkRateLimit({
    key: `design-generate:${dbUser.id}`,
    limit: 15,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: DesignContextBody & {
    image?: unknown;
    regenerateOf?: unknown;
    frames?: unknown;
    approvedOutline?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsedFields = parseContextFields(body);
  if (!parsedFields.ok) {
    return Response.json({ error: parsedFields.error }, { status: 400 });
  }
  const {
    brandId,
    briefId,
    calendarItemId,
    attachments,
    freeform,
    aspectRatio,
  } = parsedFields.fields;
  const image = parseImage(body.image);
  if (image === null) {
    return Response.json({ error: "Invalid image" }, { status: 400 });
  }
  /* Read only with FEATURE_MULTI_FRAME on: off, the field is ignored as any
     unknown field always was. */
  const frames = multiFrameEnabled() ? parseFrames(body.frames) : undefined;
  if (frames === null) {
    return Response.json({ error: "Invalid frames" }, { status: 400 });
  }
  const { regenerateOf } = body;
  if (regenerateOf != null) {
    if (typeof regenerateOf !== "string" || !isUuid(regenerateOf)) {
      return Response.json({ error: "Invalid regenerateOf" }, { status: 400 });
    }
    /* A direction is regenerated with the same image choice it was made
       with; without one there is no directions path to take. */
    if (!image) {
      return Response.json(
        { error: "regenerateOf requires an image choice" },
        { status: 400 },
      );
    }
  }

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  /* Checked against the brand row, never the request string: a key under
     another brand's prefix, or one this app never minted, is refused here so
     the job never reads it. The job re-reads and judges the real bytes. The
     message is the loader's own, so it carries IMAGE_NOT_USABLE_PREFIX and
     the UI shows its choose-another-image state. */
  if (
    image?.source === "upload" &&
    !isDesignImageKeyFor(image.key, access.brand.id)
  ) {
    return Response.json(
      { error: new DesignImageError("foreign_key").message },
      { status: 400 },
    );
  }

  if (typeof regenerateOf === "string") {
    /* One answer for "no such design" and "another brand's design", so the
       id cannot be used to probe what exists. */
    const previous = await getDesignGenerationById(regenerateOf);
    if (!previous || previous.brandId !== access.brand.id) {
      return Response.json({ error: "Design not found" }, { status: 404 });
    }
    /* A variant row has no set and no slot, so there is no pair to swap the
       new direction into; the job would have to invent one. */
    if (!readRationale(previous.rationale)?.set) {
      return Response.json(
        { error: "Only a design direction can be regenerated." },
        { status: 400 },
      );
    }
  }

  /* Fail before creating a job rather than leaving a job row that can only
     fail. An uploaded image needs no image model, so only the other paths
     need a provider. */
  /* KO imagery is behind FEATURE_KO_IMAGERY (round 8): refused before any
     job, row or model call. A request with no image takes the legacy variant
     path, which paints a KO plate too, so it is gated the same way
     (Oluwaseyi's ruling, 2026-10-29). */
  if (paintsWithKo(image) && !koImageryEnabled()) {
    return Response.json(
      {
        error: new KoImageryDisabledError().message,
        code: "ko_imagery_disabled",
      },
      { status: 403 },
    );
  }
  if (
    image?.source !== "upload" &&
    image?.source !== "none" &&
    resolveDesignProviders().length === 0
  ) {
    return Response.json(
      { error: "Image generation is not configured." },
      { status: 503 },
    );
  }
  if (!isStorageConfigured()) {
    return Response.json(
      { error: "File storage is not configured." },
      { status: 503 },
    );
  }

  /* Sets bill frame by frame and reserve the rest; one nobody will resume
     is settled first, so its unbilled frames stop holding the units this
     request is checked against. */
  if (multiFrameEnabled()) {
    const { sweepAbandonedDesignSets } = await import(
      "@/lib/jobs/run-design-sequence"
    );
    await sweepAbandonedDesignSets(access.brand.workspaceId);
  }

  const quota = await checkDesignQuota(access.brand.workspaceId);
  if (!quota.ok) return quotaExceeded(quota);

  let context: Awaited<ReturnType<typeof resolveDesignContext>>;
  try {
    context = await resolveDesignContext({
      brandId,
      briefId,
      calendarItemId,
      attachments,
      freeform,
      aspectRatio: aspectRatio ?? null,
    });
  } catch (err) {
    if (err instanceof DesignContextError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  /* A carousel or presentation becomes a set of frames (KOOS-AI-002) only
     with the flag on and an image choice, and never for a direction being
     regenerated. Its count comes from the request, else the brief. */
  const sequenceKind =
    image && regenerateOf == null && multiFrameEnabled()
      ? sequenceKindOf(context.designType)
      : null;
  let approvedOutline: ApprovedOutline | undefined;
  if (sequenceKind && body.approvedOutline != null) {
    const checked = validateApprovedOutline(body.approvedOutline, {
      kind: sequenceKind,
      briefText: context.briefText ?? "",
      profileStatements: profileStatements(context.brandSummary),
    });
    if (!checked.ok) {
      return Response.json(
        { error: "Invalid outline", problems: checked.problems },
        { status: 400 },
      );
    }
    approvedOutline = checked.outline;
  }
  /* The approved outline is what the user saw priced on the button, so its
     length wins over a `frames` field that disagrees with it. */
  const askedFrames = approvedOutline
    ? approvedOutline.points.length
    : (frames ?? context.slides);
  const sequence = sequenceKind
    ? {
        frames: clampFrameCount(sequenceKind, askedFrames),
        asked: askedFrames ?? null,
        contextRequest: {
          briefId: briefId ?? null,
          calendarItemId: calendarItemId ?? null,
          attachments,
          freeform: freeform ?? null,
          aspectRatio: aspectRatio ?? null,
        },
        ...(approvedOutline ? { approvedOutline } : {}),
      }
    : null;
  /* A set costs one unit per frame, so it is refused before the job when
     the workspace cannot pay for all of them, rather than delivering the
     first few frames of a carousel. */
  if (sequenceKind && sequence) {
    const setQuota = await checkDesignQuota(
      access.brand.workspaceId,
      new Date(),
      sequence.frames,
    );
    if (!setQuota.ok) return quotaExceeded(setQuota, sequenceKind);
  }

  const job = await createGenerationJob({
    kind: "design_render",
    userId: dbUser.id,
    brandId,
    input: {
      briefId: briefId ?? null,
      calendarItemId: calendarItemId ?? null,
      attachments,
      ...(image ? { image, regenerateOf: regenerateOf ?? null } : {}),
      ...(sequence
        ? {
            sequence: {
              frames: sequence.frames,
              asked: sequence.asked,
              ...(sequence.approvedOutline
                ? { approvedOutline: sequence.approvedOutline }
                : {}),
            },
            freeform: freeform ?? null,
            aspectRatio: aspectRatio ?? null,
          }
        : {}),
    },
  });

  const sessionId = await getAnalyticsSessionId();
  const work = (runtime: Parameters<typeof generateDesignWork>[1]) =>
    generateDesignWork(
      {
        context,
        userId: dbUser.id,
        sessionId,
        ...(image
          ? {
              directions: {
                image,
                regenerateOf:
                  typeof regenerateOf === "string" ? regenerateOf : null,
              },
            }
          : {}),
        ...(sequence ? { sequence } : {}),
      },
      runtime,
    );
  after(() =>
    sequence
      ? executeGenerationJob(job.id, work, {
          softDeadlineMs: SEQUENCE_SLICE_BUDGET_MS,
        })
      : executeGenerationJob(job.id, work),
  );

  if (sequenceKind && sequence) {
    const { frameCountNotice } = await import("@/lib/jobs/run-design-sequence");
    return Response.json(
      {
        jobId: job.id,
        frames: sequence.frames,
        notice: frameCountNotice(sequenceKind, sequence.frames, sequence.asked),
      },
      { status: 202 },
    );
  }
  return Response.json({ jobId: job.id }, { status: 202 });
}
