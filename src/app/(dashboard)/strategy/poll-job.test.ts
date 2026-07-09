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
