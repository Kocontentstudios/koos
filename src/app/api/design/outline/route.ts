import { buildMemoryBlock } from "@/lib/ai/memory";
import { getAuthUser } from "@/lib/auth/get-user";
import { requireVerifiedEmail } from "@/lib/auth/require-verified-email";
import { checkBrandAccess } from "@/lib/db/queries";
import { DesignContextError, resolveDesignContext } from "@/lib/design/context";
import { multiFrameEnabled } from "@/lib/design/multi-frame-flag";
import {
  type DesignContextBody,
  parseContextFields,
  parseFrames,
} from "@/lib/design/request-fields";
import { roleOf } from "@/lib/design/sequence/arc";
import {
  clampFrameCount,
  OUTLINE_RATE_LIMIT,
  type PlannedOutline,
  sequenceKindOf,
} from "@/lib/design/sequence/contract";
import { planOutline } from "@/lib/design/sequence/outline-plan";
import { checkRateLimit, tooManyRequests } from "@/lib/rate-limit";

// One brief read and one model call on the best model, no render.
export const maxDuration = 120;

const PLAN_FAILED =
  "We couldn't plan an outline for this brief. Try again, or add more detail to the brief.";

/** Where a planned outline breaks the shape the client relies on (OUTLINE.md
 *  "Success"), so a planner bug is a 502 here rather than an outline the
 *  editor cannot hold to its own rules. Empty when it holds. */
function outlineShapeFaults(
  outline: PlannedOutline,
  frameCount: number,
): string[] {
  const { points } = outline;
  const faults: string[] = [];
  if (points.length !== frameCount) {
    faults.push(`${points.length} points for ${frameCount}`);
  }
  points.forEach((point, i) => {
    if (point.role !== roleOf(i, points.length)) {
      faults.push(`point ${i + 1} is ${point.role}`);
    }
    if (point.id !== `p${i + 1}`) faults.push(`point ${i + 1} id ${point.id}`);
    if (point.source === "user") faults.push(`point ${i + 1} source user`);
  });
  return faults;
}

/**
 * Plans the outline of a carousel or presentation (KOOS-AI-002, rubric
 * Addendum A): N points the user edits before any copy is written or frame
 * drawn. No job, no render, no quota; the rate limit is the spend control.
 */
export async function POST(req: Request) {
  if (!multiFrameEnabled()) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  const unverified = requireVerifiedEmail(dbUser);
  if (unverified) return unverified;

  const verdict = await checkRateLimit({
    key: `design-outline:${dbUser.id}`,
    ...OUTLINE_RATE_LIMIT,
  });
  if (!verdict.ok) return tooManyRequests(verdict);

  let body: DesignContextBody & { frames?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = parseContextFields(body);
  if (!parsed.ok) {
    return Response.json({ error: parsed.error }, { status: 400 });
  }
  const frames = parseFrames(body.frames);
  if (frames === null) {
    return Response.json({ error: "Invalid frames" }, { status: 400 });
  }
  const { brandId, briefId, calendarItemId, attachments, freeform } =
    parsed.fields;

  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) {
    return Response.json({ error: access.error }, { status: access.status });
  }

  let context: Awaited<ReturnType<typeof resolveDesignContext>>;
  try {
    context = await resolveDesignContext({
      brandId,
      briefId,
      calendarItemId,
      attachments,
      freeform,
      aspectRatio: parsed.fields.aspectRatio ?? null,
    });
  } catch (err) {
    if (err instanceof DesignContextError) {
      return Response.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }

  const kind = sequenceKindOf(context.designType);
  if (!kind) {
    return Response.json(
      { error: "Only a carousel or presentation has an outline." },
      { status: 400 },
    );
  }
  const frameCount = clampFrameCount(kind, frames ?? context.slides);

  let planned: Awaited<ReturnType<typeof planOutline>>;
  try {
    planned = await planOutline({
      context,
      kind,
      frameCount,
      memorySummary: await buildMemoryBlock(access.brand.id),
    });
  } catch (err) {
    console.error("design.outline.failed", {
      kind,
      frames: frameCount,
      error: err instanceof Error ? err.message : String(err),
    });
    return Response.json({ error: PLAN_FAILED }, { status: 502 });
  }

  const { outline } = planned;
  const faults = outlineShapeFaults(outline, frameCount);
  if (faults.length > 0) {
    console.error("design.outline.failed", {
      kind,
      frames: frameCount,
      faults,
    });
    return Response.json({ error: PLAN_FAILED }, { status: 502 });
  }

  const weakOf = (kindOfWeak: string) =>
    outline.points.filter((p) => p.weak?.kind === kindOfWeak).length;
  console.info("design.outline.planned", {
    kind,
    frames: outline.points.length,
    weak: {
      overlap: weakOf("overlap"),
      filler: weakOf("filler"),
      profileFill: weakOf("profile-fill"),
    },
    overlapsSwapped: planned.overlapsSwapped ?? 0,
    modelCalls: planned.modelCalls,
    ms: planned.ms,
  });

  return Response.json({
    outline: { ...outline, frameCount: outline.points.length },
  });
}
