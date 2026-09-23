import { describe, expect, it, vi } from "vitest";
import {
  createCachedProbe,
  healthBody,
  httpStatusFor,
  type ProbeResult,
  probeDatabase,
} from "./check";

function clock(...readings: number[]) {
  let i = 0;
  return () => readings[Math.min(i++, readings.length - 1)];
}

describe("probeDatabase", () => {
  it("reports ok with the measured latency", async () => {
    const result = await probeDatabase(async () => [{ applied: 33 }], {
      now: clock(1_000, 1_042),
    });

    expect(result).toEqual({ status: "ok", latencyMs: 42 });
  });

  it("classifies a dead DNS record as unreachable", async () => {
    const result = await probeDatabase(
      () =>
        Promise.reject(
          Object.assign(new Error("getaddrinfo ENOTFOUND"), {
            code: "ENOTFOUND",
          }),
        ),
      { now: clock(0, 5) },
    );

    expect(result).toMatchObject({ status: "down", error: "unreachable" });
  });

  it.each(["ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "ECONNRESET"])(
    "treats %s as unreachable",
    async (code) => {
      const result = await probeDatabase(() =>
        Promise.reject(Object.assign(new Error(code), { code })),
      );

      expect(result.error).toBe("unreachable");
    },
  );

  /* A connection-cap or credentials failure is a different incident from a
     powered-off service, and the runbook page differs. Reporting both as
     "timeout" sent responders to the wrong page. */
  it.each([
    ["too many connections", "53300"],
    ["password authentication failed", "28P01"],
    ["relation does not exist", "42P01"],
  ])("classifies %s as an error, not a timeout", async (message, code) => {
    const result = await probeDatabase(() =>
      Promise.reject(Object.assign(new Error(message), { code })),
    );

    expect(result.error).toBe("error");
  });

  it("distinguishes a real timeout from a query error", async () => {
    vi.useFakeTimers();
    try {
      const pending = probeDatabase(() => new Promise(() => {}), {
        timeoutMs: 5_000,
      });
      await vi.advanceTimersByTimeAsync(5_000);

      await expect(pending).resolves.toMatchObject({
        status: "down",
        error: "timeout",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the timer on success so the process can exit", async () => {
    vi.useFakeTimers();
    try {
      await probeDatabase(async () => 1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reports ok when the query rejects", async () => {
    const result = await probeDatabase(() =>
      Promise.reject(new Error("anything at all")),
    );

    expect(result.status).toBe("down");
  });
});

describe("createCachedProbe", () => {
  /* Unauthenticated endpoint on a pool of one connection per instance: without
     this, `while true; do curl; done` induces the connection exhaustion the
     endpoint exists to report. */
  it("serves a cached result inside the TTL", async () => {
    const probe = vi.fn().mockResolvedValue({ status: "ok", latencyMs: 1 });
    const cached = createCachedProbe(probe, {
      ttlMs: 10_000,
      now: clock(0, 1_000, 2_000),
    });

    await cached();
    await cached();
    await cached();

    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("re-probes once the TTL expires", async () => {
    const probe = vi.fn().mockResolvedValue({ status: "ok", latencyMs: 1 });
    const cached = createCachedProbe(probe, {
      ttlMs: 10_000,
      now: clock(0, 20_000, 20_000),
    });

    await cached();
    await cached();

    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("collapses a concurrent burst onto one query", async () => {
    let release: (value: ProbeResult) => void = () => {};
    const probe = vi.fn().mockReturnValue(
      new Promise<ProbeResult>((resolve) => {
        release = resolve;
      }),
    );
    const cached = createCachedProbe(probe, { ttlMs: 10_000 });

    const all = Promise.all([cached(), cached(), cached()]);
    release({ status: "ok", latencyMs: 1 });
    await all;

    expect(probe).toHaveBeenCalledTimes(1);
  });

  /* A failure is cached exactly like a success, so an outage is reported for
     up to one TTL after recovery — and, more importantly, the flood of
     retries an outage provokes does not each open a connection. */
  it("caches a failure for its TTL, then shows recovery", async () => {
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ status: "down", latencyMs: 1, error: "timeout" })
      .mockResolvedValue({ status: "ok", latencyMs: 1 });
    const cached = createCachedProbe(probe, {
      ttlMs: 10_000,
      now: clock(0, 5_000, 20_000, 20_000),
    });

    expect((await cached()).status).toBe("down");
    expect((await cached()).status).toBe("down");
    expect(probe).toHaveBeenCalledTimes(1);

    expect((await cached()).status).toBe("ok");
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("retries after a rejected probe instead of wedging", async () => {
    const probe = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ status: "ok", latencyMs: 1 });
    const cached = createCachedProbe(probe, { ttlMs: 10_000 });

    await expect(cached()).rejects.toThrow("boom");
    await expect(cached()).resolves.toMatchObject({ status: "ok" });
  });
});

describe("httpStatusFor", () => {
  it("returns 503 when the database is down so monitors alert", () => {
    expect(httpStatusFor({ status: "down", latencyMs: 1 })).toBe(503);
    expect(httpStatusFor({ status: "ok", latencyMs: 1 })).toBe(200);
  });
});

describe("healthBody", () => {
  const meta = {
    commit: "abc1234",
    environment: "production",
    timestamp: "2026-09-23T18:00:00.000Z",
  };

  it("describes a healthy service", () => {
    expect(healthBody({ status: "ok", latencyMs: 12 }, meta)).toEqual({
      status: "ok",
      database: "ok",
      latencyMs: 12,
      commit: "abc1234",
      environment: "production",
      timestamp: meta.timestamp,
    });
  });

  it("carries the failure class and nothing else about the failure", () => {
    const body = healthBody(
      { status: "down", latencyMs: 5_000, error: "unreachable" },
      meta,
    );

    expect(body).toMatchObject({ status: "degraded", reason: "unreachable" });
    expect(Object.keys(body).sort()).toEqual([
      "commit",
      "database",
      "environment",
      "latencyMs",
      "reason",
      "status",
      "timestamp",
    ]);
  });

  it("falls back to unknown metadata rather than throwing", () => {
    expect(
      healthBody({ status: "ok", latencyMs: 1 }, { timestamp: meta.timestamp }),
    ).toMatchObject({ commit: "unknown", environment: "unknown" });
  });
});
