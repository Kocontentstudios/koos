import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/queries", () => ({ hitRateLimit: vi.fn() }));

import {
  checkRateLimit,
  clientIpFrom,
  evaluateWindow,
  tooManyRequests,
} from "./rate-limit";

const NOW = new Date("2026-07-09T12:00:00Z");

describe("evaluateWindow", () => {
  it("allows hits at or under the limit", () => {
    const hit = { count: 5, windowStart: NOW };
    expect(evaluateWindow(hit, { limit: 5, windowSeconds: 60 }, NOW)).toEqual({
      ok: true,
      retryAfterSeconds: 0,
    });
  });

  it("blocks hits over the limit with time remaining in the window", () => {
    const windowStart = new Date(NOW.getTime() - 20_000); // 20s into a 60s window
    const verdict = evaluateWindow(
      { count: 6, windowStart },
      { limit: 5, windowSeconds: 60 },
      NOW,
    );
    expect(verdict.ok).toBe(false);
    expect(verdict.retryAfterSeconds).toBe(40);
  });

  it("never returns a retry below 1 second", () => {
    const windowStart = new Date(NOW.getTime() - 61_000); // window just expired
    const verdict = evaluateWindow(
      { count: 6, windowStart },
      { limit: 5, windowSeconds: 60 },
      NOW,
    );
    expect(verdict.retryAfterSeconds).toBe(1);
  });
});

describe("checkRateLimit", () => {
  it("consults the counter and applies the policy", async () => {
    const hit = vi.fn().mockResolvedValue({ count: 3, windowStart: NOW });
    const verdict = await checkRateLimit(
      { key: "login:1.2.3.4", limit: 5, windowSeconds: 60 },
      hit,
    );
    expect(hit).toHaveBeenCalledWith("login:1.2.3.4", 60);
    expect(verdict.ok).toBe(true);
  });

  it("fails open when the counter query throws", async () => {
    const hit = vi.fn().mockRejectedValue(new Error("db down"));
    const verdict = await checkRateLimit(
      { key: "login:1.2.3.4", limit: 5, windowSeconds: 60 },
      hit,
    );
    expect(verdict.ok).toBe(true);
  });
});

describe("clientIpFrom", () => {
  it("takes the first x-forwarded-for hop", () => {
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.7, 10.0.0.1",
    });
    expect(clientIpFrom(headers)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip then a shared bucket", () => {
    expect(clientIpFrom(new Headers({ "x-real-ip": "198.51.100.2" }))).toBe(
      "198.51.100.2",
    );
    expect(clientIpFrom(new Headers())).toBe("unknown");
  });
});

describe("tooManyRequests", () => {
  it("returns 429 with Retry-After", async () => {
    const res = tooManyRequests({ ok: false, retryAfterSeconds: 42 });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/too many requests/i);
  });
});
