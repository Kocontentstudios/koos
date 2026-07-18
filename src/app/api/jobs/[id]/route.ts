import { getAuthUser } from "@/lib/auth/get-user";
import { getGenerationJobById, updateGenerationJob } from "@/lib/db/queries";
import { isUuid } from "@/lib/validation/uuid";

/**
 * A pending/running job whose row hasn't been touched for this long is dead —
 * the worker was killed (deploy, serverless timeout) before it could record a
 * terminal state. Healthy calendar runs write progress every few seconds, so
 * this only fires on genuinely orphaned jobs.
 */
const STALE_JOB_MS = 4 * 60 * 1000;

const STALLED_ERROR = "Generation stalled. Please try again.";

/** In-flight progress parked in the result column by executeGenerationJob. */
function progressFrom(result: unknown): unknown {
  if (result && typeof result === "object" && "progress" in result) {
    return (result as { progress: unknown }).progress;
  }
  return null;
}

/**
 * Poll a generation job's status. Owned jobs only; 404 for anything else so
 * job ids don't leak existence. The `result` payload is included once the
 * job succeeds and matches what the old synchronous route returned; while the
 * job runs, `progress` carries the worker's last reported step.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }
  const job = await getGenerationJobById(id);
  if (!job || job.userId !== dbUser.id) {
    return Response.json({ error: "Job not found" }, { status: 404 });
  }

  const running = job.status === "pending" || job.status === "running";
  if (running && Date.now() - job.updatedAt.getTime() > STALE_JOB_MS) {
    await updateGenerationJob(job.id, {
      status: "failed",
      error: STALLED_ERROR,
    });
    return Response.json({
      status: "failed",
      kind: job.kind,
      result: null,
      error: STALLED_ERROR,
    });
  }

  return Response.json({
    status: job.status,
    kind: job.kind,
    result: job.status === "succeeded" ? job.result : null,
    error: job.status === "failed" ? job.error : null,
    progress: running ? progressFrom(job.result) : null,
  });
}
