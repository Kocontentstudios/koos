import { after } from "next/server";
import { getAuthUser } from "@/lib/auth/get-user";
import {
  checkBrandAccess,
  claimPausedGenerationJob,
  claimStaleGenerationJob,
  getGenerationJobById,
  updateGenerationJob,
} from "@/lib/db/queries";
import { resumeCalendarJob } from "@/lib/jobs/run-generation";
import {
  isPausedForResume,
  resolveStaleAction,
  resumeCountFrom,
  staleMsFor,
} from "@/lib/jobs/stale";
import { isUuid } from "@/lib/validation/uuid";

// Headroom for a resumed calendar slice kicked off via after().
export const maxDuration = 300;

const STALLED_ERROR = "Generation stalled. Please try again.";

type ClaimedJob = NonNullable<
  Awaited<ReturnType<typeof claimPausedGenerationJob>>
>;

/* The poll checked access before claiming, but a revoke can land between that
   check and this callback; checking again here, after the claim and right
   before the spend, closes that window. */
async function resumeIfStillAllowed(claimed: ClaimedJob, userId: string) {
  const access = await checkBrandAccess(
    userId,
    claimed.brandId,
    "manage_content",
  );
  if (!access.ok) {
    await updateGenerationJob(claimed.id, {
      status: "failed",
      error: access.error,
    });
    return;
  }
  await resumeCalendarJob(claimed);
}

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

  /* Resuming spends model credit and a finished job hands over its output,
     so both re-check access: a workspace revoked (or a member removed)
     mid-job must neither keep paying for the slices still to come nor
     collect the result. A poll of a job still running stays cheap. */
  const resumes = isPausedForResume(job.result) || action === "resume";
  if (resumes || job.status === "succeeded") {
    const access = await checkBrandAccess(
      dbUser.id,
      job.brandId,
      "manage_content",
    );
    if (!access.ok && !resumes) {
      return Response.json({ error: access.error }, { status: access.status });
    }
    if (!access.ok) {
      await updateGenerationJob(job.id, {
        status: "failed",
        error: access.error,
      });
      return Response.json({
        status: "failed",
        kind: job.kind,
        result: null,
        error: access.error,
      });
    }
  }

  // A deliberately paused job is ready now — resume without waiting for it
  // to look dead. Checked before the stale branch so a pause that also went
  // silent still takes the cheap path and keeps its resume budget.
  if (isPausedForResume(job.result)) {
    const claimed = await claimPausedGenerationJob(job.id);
    if (claimed) {
      console.log(`continuing paused generation job ${job.id}`);
      after(() =>
        resumeIfStillAllowed(claimed, dbUser.id).catch((err) => {
          console.error(
            `continuation of generation job ${job.id} crashed`,
            err,
          );
        }),
      );
    }
    return Response.json({
      status: job.status,
      kind: job.kind,
      result: null,
      error: null,
      progress: progressFrom(job.result),
    });
  }

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
        resumeIfStillAllowed(claimed, dbUser.id).catch((err) => {
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
