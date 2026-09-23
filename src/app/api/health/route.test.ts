import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The point of this route is that it touches the database, so the client is
   the one thing that has to be faked: CI has no DATABASE_URL and importing the
   real client throws at module load. The argument is captured, not discarded,
   so the test can prove which query was issued. */
const execute = vi.fn();
vi.mock("@/lib/db/client", () => ({
  db: { execute: (query: unknown) => execute(query) },
}));

import { GET } from "./route";

const req = (headers: Record<string, string> = {}) =>
  new Request("https://app.example.com/api/health", { headers });

/** The drizzle SQL object keeps its literal fragments in queryChunks. */
function issuedSql(): string {
  const [query] = execute.mock.calls.at(-1) ?? [];
  return JSON.stringify(query ?? {});
}

/* The route's probe cache is module state that outlives each test, so the
   clock only ever moves forward: resetting it to a fixed instant would leave
   every case reading the first case's cached verdict. */
let clockMs = Date.UTC(2026, 8, 23, 18, 0, 0);

describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clockMs += 60_000;
    vi.setSystemTime(clockMs);
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "abc1234def5678");
    vi.stubEnv("VERCEL_ENV", "production");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("returns 200 and the deployed commit when migrations are present", async () => {
    execute.mockResolvedValue([{ applied: 33 }]);

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      database: "ok",
      commit: "abc1234",
      environment: "production",
    });
  });

  /* "Did it call a mock" is not the behaviour under test: the route must read a
     real table, because `select 1` passes against an empty database. */
  it("queries the _migrations table, not a bare select", async () => {
    execute.mockResolvedValue([{ applied: 33 }]);

    await GET(req());

    expect(issuedSql()).toContain("_migrations");
    expect(issuedSql()).toContain("count");
  });

  /* A deploy against a freshly recreated database rebuilds the schema, so a
     socket check reports healthy while every row is gone. */
  it("returns 503 when the database is empty", async () => {
    execute.mockResolvedValue([{ applied: 0 }]);

    const res = await GET(req());

    expect(res.status).toBe(503);
    expect((await res.json()).reason).toBe("error");
  });

  /* The 2026-09-23 outage: service powered off, DNS record gone, every static
     page still answering 200. */
  it("returns 503 when the database host does not resolve", async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("getaddrinfo ENOTFOUND pg-x.aivencloud.com"), {
        code: "ENOTFOUND",
      }),
    );

    const res = await GET(req());

    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      status: "degraded",
      reason: "unreachable",
    });
  });

  it("reports a connection-cap failure as an error, not as unreachable", async () => {
    execute.mockRejectedValue(
      Object.assign(new Error("too many connections"), { code: "53300" }),
    );

    expect((await (await GET(req())).json()).reason).toBe("error");
  });

  it("never leaks the database host or credentials in the failure body", async () => {
    execute.mockRejectedValue(
      new Error("connect ECONNREFUSED postgres://user:pw@pg-x:17462/defaultdb"),
    );

    const serialized = JSON.stringify(await (await GET(req())).json());

    expect(serialized).not.toContain("pg-x");
    expect(serialized).not.toContain("aivencloud");
    expect(serialized).not.toContain("pw@");
  });

  it("is never cached by the CDN, so a monitor sees live state", async () => {
    execute.mockResolvedValue([{ applied: 33 }]);

    expect((await GET(req())).headers.get("cache-control")).toBe("no-store");
  });

  /* Unauthenticated and DB-backed: a request loop must not become a connection
     amplifier against the cap this endpoint exists to report on. */
  it("does not open a database connection per request", async () => {
    execute.mockResolvedValue([{ applied: 33 }]);

    await GET(req());
    await GET(req());
    await GET(req());

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("GET /api/health with HEALTH_PROBE_TOKEN set", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    clockMs += 60_000;
    vi.setSystemTime(clockMs);
    vi.stubEnv("HEALTH_PROBE_TOKEN", "s3cret-token");
    execute.mockResolvedValue([{ applied: 33 }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  /* The probe cache is per serverless instance, so an unauthenticated flood
     still fans out across instances and opens a connection on each. */
  it("refuses an unauthenticated request without touching the database", async () => {
    const res = await GET(req());

    expect(res.status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("refuses a wrong token", async () => {
    expect((await GET(req({ "x-health-token": "wrong" }))).status).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("serves the monitor that presents the token", async () => {
    const res = await GET(req({ "x-health-token": "s3cret-token" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });
  });
});
