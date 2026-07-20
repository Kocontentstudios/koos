import { after } from "next/server";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  claimStaleGenerationJob,
  getGenerationJobById,
  updateGenerationJob,
} from "@/lib/db/queries";
import { resumeCalendarJob } from "@/lib/jobs/run-generation";
import {
  resolveStaleAction,
  resumeCountFrom,
  staleMsFor,
} from "@/lib/jobs/stale";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for a resumed calendar slice kicked off via after().
export const maxDuration = 300;

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
 * job succeeds; while the job runs, `progress` carries the worker's last
 * reported step.
 *
 * This route is also the resume driver for checkpointed calendar jobs: when
 * the worker's heartbeat goes silent (serverless 300s kill, deploy), the
 * poll atomically claims the job and relaunches the remaining work from its
 * checkpoint via after() — bounded by MAX_RESUMES, after which the job
 * fails for real. Non-resumable kinds keep the original stale→fail window.
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

  const action = resolveStaleAction(
    {
      kind: job.kind,
      status: job.status,
      updatedAt: job.updatedAt,
      resumeCount: resumeCountFrom(job.result),
    },
    Date.now(),
  );

  if (action === "fail") {
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

  if (action === "resume") {
    // The staleness condition inside the UPDATE makes concurrent pollers
    // race safely: only the winner gets a row back and relaunches.
    const claimed = await claimStaleGenerationJob(job.id, staleMsFor(job.kind));
    if (claimed) {
      console.log(
        `resuming generation job ${job.id} (attempt ${resumeCountFrom(claimed.result)})`,
      );
      after(() =>
        resumeCalendarJob(claimed).catch((err) => {
          // A crash here would otherwise be silent: the job stays "running"
          // and burns a resume attempt with no trace in the logs.
          console.error(`resume of generation job ${job.id} crashed`, err);
        }),
      );
    }
  }

  const running = job.status === "pending" || job.status === "running";
  return Response.json({
    status: job.status,
    kind: job.kind,
    result: job.status === "succeeded" ? job.result : null,
    error: job.status === "failed" ? job.error : null,
    progress: running ? progressFrom(job.result) : null,
  });
}
