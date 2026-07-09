/** Client-side polling for async generation jobs (/api/jobs/[id]). */

export interface JobStatusResponse<T> {
  status: "pending" | "running" | "succeeded" | "failed";
  result: T | null;
  error: string | null;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
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
    await sleep(intervalMs);
  }
  throw new Error(
    "Generation is taking longer than expected. Please try again.",
  );
}
