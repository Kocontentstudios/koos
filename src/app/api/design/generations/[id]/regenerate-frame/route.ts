import { after } from "next/server";
import { resolveDesignProviders } from "@/lib/ai/image";
import { getAnalyticsSessionId } from "@/lib/analytics/session-id";
import { getAuthUser } from "@/lib/auth/get-user";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import {
  checkBrandAccess,
  createGenerationJob,
  getDesignGenerationById,
  getDesignSet,
  listSetFrames,
} from "@/lib/db/queries";
import { DesignContextError, resolveDesignContext } from "@/lib/design/context";
import {
  KoImageryDisabledError,
  koImageryEnabled,
} from "@/lib/design/ko-imagery-flag";
import { multiFrameEnabled } from "@/lib/design/multi-frame-flag";
import { checkDesignQuota, quotaExceeded } from "@/lib/design/quota";
import type { FrameEdits } from "@/lib/design/sequence/contract";
import { serializedFrameOf } from "@/lib/design/sequence/frames";
import { COPY_LIMITS } from "@/lib/jobs/directions/schema";
import {
  contextRequestOf,
  FrameBusyError,
  FrameTargetError,
  frameToReplace,
  regenerateFrameWork,
  type SequenceContextRequest,
  sweepAbandonedDesignSets,
} from "@/lib/jobs/run-design-sequence";
import { executeGenerationJob } from "@/lib/jobs/run-generation";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";
import { isStorageConfigured } from "@/lib/storage";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for the post-response render kicked off via after().
export const maxDuration = 300;

const EDIT_FIELDS = ["headline", "subheadline", "cta"] as const;

/**
 * The user's copy for one frame, checked against the limits the renderer
 * draws to. Anything malformed is an error, so a bad payload is a 400
 * rather than a partly honoured edit. A field left out keeps its text.
 */
function parseFrameEdits(
  value: unknown,
): { edits: FrameEdits | undefined } | { error: string } {
  if (value == null) return { edits: undefined };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "Invalid edits" };
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const edits: FrameEdits = {};
  for (const [field, text] of entries) {
    if (!(EDIT_FIELDS as readonly string[]).includes(field)) {
      return { error: "Invalid edits" };
    }
    if (typeof text !== "string") return { error: "Invalid edits" };
    const name = field as (typeof EDIT_FIELDS)[number];
    const trimmed = text.trim();
    if (trimmed.length > COPY_LIMITS[name]) {
      return {
        error: `The ${name} must be ${COPY_LIMITS[name]} characters or fewer.`,
      };
    }
    if (name === "headline" && trimmed.length === 0) {
      return { error: "A frame needs a headline." };
    }
    edits[name] = trimmed;
  }
  return { edits: entries.length > 0 ? edits : undefined };
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Draws one frame of a carousel or presentation again (KOOS-AI-002): with
 * the user's copy exactly as typed, or a fresh rewrite, on the set's palette,
 * logo and fonts. Returns 202 + jobId; the client polls /api/jobs/[id]. The
 * frame on show stays until the new one is delivered. Costs one unit.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  /* With the flag off there are no sets, so there is nothing here. */
  if (!multiFrameEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

  /* The same budget as generating: a frame is a design. */
  const verdict = await checkRateLimit({
    key: `design-generate:${dbUser.id}`,
    limit: 15,
    windowSeconds: 3600,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Design not found" }, { status: 404 });
  }
  const body = await readBody(req);
  if (!body) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = parseFrameEdits(body.edits);
  if ("error" in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }

  /* One answer for "no such design" and "another brand's design", so the
     id cannot be used to probe what exists. */
  const generation = await getDesignGenerationById(id);
  if (!generation) {
    return Response.json({ error: "Design not found" }, { status: 404 });
  }
  const access = await checkBrandAccess(
    dbUser.id,
    generation.brandId,
    "manage_content",
  );
  if (!access.ok) {
    return Response.json({ error: "Design not found" }, { status: 404 });
  }
  const frame = serializedFrameOf(generation);
  if (!frame) {
    return Response.json(
      { error: "Only a frame of a carousel or presentation can be redrawn." },
      { status: 400 },
    );
  }
  /* Only the last frame carries the set's button (H3); an edit that gave
     another frame one would break the set it belongs to. */
  if (parsed.edits?.cta && frame.role !== "cta") {
    return Response.json(
      { error: "Only the last frame carries a button." },
      { status: 400 },
    );
  }
  /* And the last frame always carries it: an empty button would leave the
     set with no action to take. */
  if (frame.role === "cta" && parsed.edits?.cta === "") {
    return Response.json(
      { error: "The last frame needs a button." },
      { status: 400 },
    );
  }
  const set = await getDesignSet(generation.brandId, frame.setId);
  if (!set) {
    return Response.json({ error: "Design not found" }, { status: 404 });
  }
  let target: ReturnType<typeof frameToReplace>;
  try {
    target = frameToReplace(
      await listSetFrames(generation.brandId, frame.setId),
      generation,
    );
  } catch (err) {
    if (err instanceof FrameBusyError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof FrameTargetError) {
      return Response.json({ error: "Design not found" }, { status: 404 });
    }
    throw err;
  }

  if (generation.imageSource === "ko") {
    if (!koImageryEnabled()) {
      return Response.json(
        {
          error: new KoImageryDisabledError().message,
          code: "ko_imagery_disabled",
        },
        { status: 403 },
      );
    }
    if (resolveDesignProviders().length === 0) {
      return Response.json(
        { error: "Image generation is not configured." },
        { status: 503 },
      );
    }
  }
  if (!isStorageConfigured()) {
    return Response.json(
      { error: "File storage is not configured." },
      { status: 503 },
    );
  }

  await sweepAbandonedDesignSets(access.brand.workspaceId);
  const quota = await checkDesignQuota(access.brand.workspaceId);
  if (!quota.ok) return quotaExceeded(quota);

  let context: Awaited<ReturnType<typeof resolveDesignContext>>;
  try {
    context = await resolveDesignContext({
      brandId: generation.brandId,
      ...contextRequestOf(set.request as Partial<SequenceContextRequest>),
    });
  } catch (err) {
    if (err instanceof DesignContextError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  const job = await createGenerationJob({
    kind: "design_render",
    userId: dbUser.id,
    brandId: generation.brandId,
    input: { regenerateFrame: target.id, edits: parsed.edits ?? null },
  });

  const sessionId = await getAnalyticsSessionId();
  after(() =>
    executeGenerationJob(job.id, (runtime) =>
      regenerateFrameWork(
        {
          context,
          userId: dbUser.id,
          sessionId,
          generationId: target.id,
          edits: parsed.edits,
        },
        runtime,
      ),
    ),
  );

  return Response.json({ jobId: job.id }, { status: 202 });
}
