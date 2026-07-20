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

/**
 * Poll a job until it reaches a terminal state. Resolves with the job's
 * result on success; throws with the job's error (or a timeout message)
 * otherwise.
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
  while (Date.now() < deadline) {
    const res = await fetchImpl(`/api/jobs/${jobId}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? "Could not check generation progress");
    }
    const data = (await res.json()) as JobStatusResponse<T>;
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
