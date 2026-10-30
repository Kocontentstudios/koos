/**
 * Why a poll stopped without the job reaching an end. Neither means the job
 * failed: it runs server-side and may still deliver. Kept apart from
 * poll-job.ts so a caller can tell these from a job failure even where a
 * test replaces the poll itself.
 */

export class PollTimeoutError extends Error {
  constructor() {
    super("Generation is taking longer than expected. Please try again.");
    this.name = "PollTimeoutError";
  }
}

export class PollConnectionLostError extends Error {
  constructor() {
    super(
      "Lost connection while checking generation progress. Generation continues in the background — check back shortly.",
    );
    this.name = "PollConnectionLostError";
  }
}

/** True when the client stopped waiting, as opposed to the job failing. */
export function stoppedWaiting(err: unknown): boolean {
  return (
    err instanceof PollTimeoutError || err instanceof PollConnectionLostError
  );
}
