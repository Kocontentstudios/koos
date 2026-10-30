import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordingDb } from "@/lib/db/queries/query-recorder";

const { dbProxy, setCurrent } = vi.hoisted(() => {
  let current: { db: Record<string, unknown> };
  return {
    dbProxy: new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => current.db[prop as string],
    }),
    setCurrent: (next: { db: Record<string, unknown> }) => {
      current = next;
    },
  };
});

vi.mock("@/lib/db/client", () => ({ db: dbProxy }));

import { MAX_OPEN_SET_JOBS } from "./open-set-jobs";
import { listOpenSetJobs } from "./open-set-jobs.server";

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const SET = "9b1d7c1e-5f7e-4d4b-8f43-2f8f0c1a0b11";
const NOW = Date.parse("2026-10-30T12:00:00.000Z");

let rec: ReturnType<typeof recordingDb>;
beforeEach(() => {
  rec = recordingDb([
    {
      id: "job-set",
      status: "running",
      result: {
        progress: { stage: "render", sequenceKind: "carousel", setId: SET },
      },
      createdAt: new Date(NOW - 60_000),
    },
    {
      id: "job-directions",
      status: "running",
      result: { progress: { stage: "render", done: 1, total: 2 } },
      createdAt: new Date(NOW - 30_000),
    },
  ]);
  setCurrent(rec as unknown as { db: Record<string, unknown> });
});

describe("listOpenSetJobs", () => {
  /* /api/jobs/[id] answers only the job's owner, and a brand filter alone
     would list a teammate's jobs that this user can never poll. */
  it("asks for the user's own unfinished design jobs for the brand, recent first", async () => {
    await listOpenSetJobs(USER, BRAND, NOW);
    const where = rec.recorded.where;
    expect(where?.sql).toContain('"generation_jobs"."user_id" =');
    expect(where?.sql).toContain('"generation_jobs"."brand_id" =');
    expect(where?.sql).toContain('"generation_jobs"."kind" =');
    expect(where?.sql).toContain('"generation_jobs"."status" in');
    expect(where?.sql).toContain('"generation_jobs"."created_at" >=');
    expect(where?.params).toEqual(
      expect.arrayContaining([
        USER,
        BRAND,
        "design_render",
        "pending",
        "running",
      ]),
    );
    expect(rec.recorded.orderBy.join(" ")).toContain("created_at");
    expect(rec.recorded.limit).toBe(MAX_OPEN_SET_JOBS);
  });

  it("returns only the jobs building a set", async () => {
    expect(await listOpenSetJobs(USER, BRAND, NOW)).toEqual([
      {
        jobId: "job-set",
        kind: "set",
        sequenceKind: "carousel",
        setId: SET,
        startedAt: NOW - 60_000,
      },
    ]);
  });
});
