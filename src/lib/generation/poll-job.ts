/** Client-side polling for async generation jobs (/api/jobs/[id]). */

export interface JobProgress {
  done: number;
  total: number;
  label: string;
}

export interface JobStatusResponse<T> {
  status: "pending" | "running" | "succeeded" | "failed";
  result: T | null;
  error: string | null;
  /** Worker-reported step, present only while the job runs. */
  progress?: JobProgress | null;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Called on every poll that carries in-flight progress. */
  onProgress?: (progress: JobProgress) => void;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Consecutive failed polls tolerated before giving up. Generation runs
    server-side, so a network blip on the polling side must not surface as a
    "generation failed" — only a sustained outage should. */
const MAX_CONSECUTIVE_FAILURES = 10;

/** A 4xx poll response: retrying cannot help (auth loss, unknown job). */
class FatalPollError extends Error {}

/**
 * Poll a job until it reaches a terminal state. Resolves with the job's
 * result on success; throws with the job's error (or a timeout message)
 * otherwise. Transient poll failures — network errors and 5xx responses —
 * are retried until MAX_CONSECUTIVE_FAILURES in a row; 4xx responses are
 * fatal (auth loss, unknown job).
 */
export async function pollGenerationJob<T>(
  jobId: string,
  {
    intervalMs = 3000,
    timeoutMs = 5 * 60 * 1000,
    fetchImpl = fetch,
    sleep = defaultSleep,
    onProgress,
  }: PollOptions = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let consecutiveFailures = 0;
  while (Date.now() < deadline) {
    let data: JobStatusResponse<T>;
    try {
      const res = await fetchImpl(`/api/jobs/${jobId}`);
      if (!res.ok) {
        if (res.status >= 500) throw new Error(`poll got ${res.status}`);
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new FatalPollError(
          body.error ?? "Could not check generation progress",
        );
      }
      data = (await res.json()) as JobStatusResponse<T>;
    } catch (err) {
      if (err instanceof FatalPollError) throw err;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          "Lost connection while checking generation progress. Generation continues in the background — check back shortly.",
        );
      }
      await sleep(intervalMs);
      continue;
    }
    consecutiveFailures = 0;
    if (data.status === "succeeded") {
      if (data.result == null) throw new Error("Generation returned no result");
      return data.result;
    }
    if (data.status === "failed") {
      throw new Error(data.error ?? "Generation failed. Please try again.");
    }
    if (data.progress && onProgress) onProgress(data.progress);
    await sleep(intervalMs);
  }
  throw new Error(
    "Generation is taking longer than expected. Please try again.",
  );
}
