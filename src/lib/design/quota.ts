import { countDesignGenerationsForWorkspace } from "@/lib/db/queries";

export const DEFAULT_MONTHLY_QUOTA = 200;

export interface QuotaVerdict {
  ok: boolean;
  used: number;
  limit: number;
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
): Promise<QuotaVerdict> {
  const limit = resolveMonthlyQuota();
  const used = await countDesignGenerationsForWorkspace(
    workspaceId,
    monthStart(now),
  );
  return { ok: used < limit, used, limit, resetsAt: monthEnd(now) };
}

export function quotaExceeded(verdict: QuotaVerdict): Response {
  return Response.json(
    {
      error: `This workspace has used all ${verdict.limit} design generations for this month. The allowance resets on ${verdict.resetsAt.toISOString().slice(0, 10)}.`,
      used: verdict.used,
      limit: verdict.limit,
      resetsAt: verdict.resetsAt.toISOString(),
    },
    { status: 429 },
  );
}
