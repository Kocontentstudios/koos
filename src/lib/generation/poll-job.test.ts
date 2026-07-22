import { describe, expect, it, vi } from "vitest";
import { pollGenerationJob } from "./poll-job";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const noSleep = () => Promise.resolve();

describe("pollGenerationJob", () => {
  it("resolves with the result once the job succeeds", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: "running", result: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "succeeded",
          result: { calendarId: "abc" },
          error: null,
        }),
      );
    const result = await pollGenerationJob<{ calendarId: string }>("job-1", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(result).toEqual({ calendarId: "abc" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/jobs/job-1");
  });

  it("throws the job's error when it fails", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "failed",
        result: null,
        error: "The AI could not generate a calendar.",
      }),
    );
    await expect(
      pollGenerationJob("job-2", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toThrow("The AI could not generate a calendar.");
  });

  it("throws on a non-OK poll response", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "Job not found" }, 404));
    await expect(
      pollGenerationJob("job-3", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toThrow("Job not found");
  });

  it("reports in-flight progress to onProgress", async () => {
    const progress = { done: 2, total: 5, label: "Writing briefs — week 1…" };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ status: "running", result: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "running",
          result: null,
          error: null,
          progress,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "succeeded",
          result: { ok: true },
          error: null,
        }),
      );
    const onProgress = vi.fn();
    await pollGenerationJob("job-5", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith(progress);
  });

  it("survives transient network errors and still resolves", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(
        jsonResponse({ status: "running", result: null, error: null }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "succeeded",
          result: { ok: true },
          error: null,
        }),
      );
    const result = await pollGenerationJob("job-6", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(result).toEqual({ ok: true });
  });

  it("survives transient 5xx poll responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "upstream" }, 502))
      .mockResolvedValueOnce(
        jsonResponse({
          status: "succeeded",
          result: { ok: true },
          error: null,
        }),
      );
    const result = await pollGenerationJob("job-7", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(result).toEqual({ ok: true });
  });

  it("gives up after too many consecutive failed polls", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("offline"));
    await expect(
      pollGenerationJob("job-8", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/connection/i);
    expect(fetchImpl).toHaveBeenCalledTimes(10);
  });

  it("a successful poll resets the consecutive-failure count", async () => {
    let calls = 0;
    const fetchImpl = vi.fn().mockImplementation(() => {
      calls++;
      // 9 failures, one good "running" poll, 9 more failures, then success:
      // never 10 consecutive failures, so polling must keep going.
      if (calls === 10) {
        return Promise.resolve(
          jsonResponse({ status: "running", result: null, error: null }),
        );
      }
      if (calls === 20) {
        return Promise.resolve(
          jsonResponse({
            status: "succeeded",
            result: { ok: true },
            error: null,
          }),
        );
      }
      return Promise.reject(new TypeError("offline"));
    });
    const result = await pollGenerationJob("job-9", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: noSleep,
    });
    expect(result).toEqual({ ok: true });
  });

  it("times out when the job never terminates", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ status: "running", result: null, error: null }),
      );
    await expect(
      pollGenerationJob("job-4", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        sleep: noSleep,
        timeoutMs: 0,
      }),
    ).rejects.toThrow(/taking longer than expected/);
  });
});
