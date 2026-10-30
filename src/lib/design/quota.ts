import {
  countDesignGenerationsForWorkspace,
  countReservedDesignUnitsForWorkspace,
} from "@/lib/db/queries";
import { ABANDONED_SET_MS } from "@/lib/jobs/stale";
import { multiFrameEnabled } from "./multi-frame-flag";

export const DEFAULT_MONTHLY_QUOTA = 200;

export interface QuotaVerdict {
  ok: boolean;
  /** Units billed this month, plus the units sets still being drawn are
   *  owed (they bill frame by frame as each lands). */
  used: number;
  limit: number;
  /** Units this request needs: one per design, one per frame of a set. */
  requested: number;
  /** First instant of the next calendar month, when the allowance resets. */
  resetsAt: Date;
}

export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function monthEnd(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function resolveMonthlyQuota(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = Number(env.DESIGN_GENERATION_MONTHLY_QUOTA);
  return Number.isFinite(raw) && raw > 0
    ? Math.floor(raw)
    : DEFAULT_MONTHLY_QUOTA;
}

/** Monthly ceiling per workspace, layered on top of the per-user hourly rate
 * limit. The hourly limit stops a runaway loop; this stops a slow burn of
 * expensive native-model renders across a whole team. */
export async function checkDesignQuota(
  workspaceId: string,
  now = new Date(),
  requested = 1,
): Promise<QuotaVerdict> {
  const limit = resolveMonthlyQuota();
  const [billed, reserved] = await Promise.all([
    countDesignGenerationsForWorkspace(workspaceId, monthStart(now)),
    /* Only sets reserve units, and sets exist only with the flag on; off,
       the check is the one query it has always been. */
    multiFrameEnabled()
      ? countReservedDesignUnitsForWorkspace(
          workspaceId,
          new Date(now.getTime() - ABANDONED_SET_MS),
        )
      : 0,
  ]);
  const used = billed + reserved;
  return {
    ok: used + requested <= limit,
    used,
    limit,
    requested,
    resetsAt: monthEnd(now),
  };
}

/** The refusal in the user's words. A set is refused up front when the
 *  workspace cannot pay for every frame, and says by how much, rather than
 *  delivering the first few frames of a carousel. */
export function quotaMessage(verdict: QuotaVerdict, what = "design"): string {
  const resets = verdict.resetsAt.toISOString().slice(0, 10);
  if (verdict.requested <= 1) {
    return `This workspace has used all ${verdict.limit} design generations for this month. The allowance resets on ${resets}.`;
  }
  const left = Math.max(0, verdict.limit - verdict.used);
  return `This ${what} needs ${verdict.requested} designs; this workspace has ${left === 0 ? "none" : left} left this month. The allowance resets on ${resets}.`;
}

export function quotaExceeded(verdict: QuotaVerdict, what?: string): Response {
  return Response.json(
    {
      error: quotaMessage(verdict, what),
      used: verdict.used,
      limit: verdict.limit,
      ...(verdict.requested > 1 ? { requested: verdict.requested } : {}),
      resetsAt: verdict.resetsAt.toISOString(),
    },
    { status: 429 },
  );
}
