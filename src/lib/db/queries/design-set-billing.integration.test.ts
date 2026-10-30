// @vitest-environment node
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The SQL that keeps a set's quota honest (KOOS-AI-002 H7), against a real
 * Postgres: the units sets in flight reserve, the atomic sweep of sets
 * nobody will resume, and the set-level annotation of per-frame usage rows.
 * Mocked unit tests cannot see a jsonb path or a cast go wrong; this can.
 *
 * Opt-in like the directions integration test: it runs only when
 * KOOS_INTEGRATION_DATABASE_URL names a local database with migration 0039
 * applied, and skips otherwise unless KOOS_INTEGRATION_REQUIRED=1.
 *
 *   KOOS_INTEGRATION_DATABASE_URL=postgres://koos:koos@localhost:5434/koos \
 *     corepack pnpm vitest run src/lib/db/queries/design-set-billing.integration.test.ts
 */

const LOCAL_DB = process.env.KOOS_INTEGRATION_DATABASE_URL ?? "";
const isLocal =
  /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//.test(LOCAL_DB);

const previousUrl = process.env.DATABASE_URL;
if (isLocal) process.env.DATABASE_URL = LOCAL_DB;

async function localDatabaseReady(): Promise<boolean> {
  if (!isLocal) return false;
  const probe = postgres(LOCAL_DB, { max: 1, connect_timeout: 2 });
  try {
    const rows = await probe`
      select 1 from information_schema.columns
      where table_name = 'design_generations' and column_name = 'set_id'`;
    return rows.length === 1;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 }).catch(() => {});
  }
}

const ready = await localDatabaseReady();
if (!ready && process.env.KOOS_INTEGRATION_REQUIRED === "1") {
  throw new Error(
    "KOOS_INTEGRATION_REQUIRED=1, but KOOS_INTEGRATION_DATABASE_URL is not a migrated local database",
  );
}

describe.runIf(ready)("set billing queries against the local database", () => {
  const sql = postgres(LOCAL_DB, { max: 1 });
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const brandId = randomUUID();
  const otherBrandId = randomUUID();
  let q: typeof import("./index");

  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  async function setJob({
    frames,
    setId,
    updatedAt = new Date(),
    status = "running",
    brand = brandId,
  }: {
    frames: number;
    setId: string | null;
    updatedAt?: Date;
    status?: string;
    brand?: string;
  }) {
    const id = randomUUID();
    const result = setId ? { checkpoint: { setId } } : { checkpoint: {} };
    await sql`insert into generation_jobs (id, kind, user_id, brand_id, status, input, result, updated_at)
              values (${id}, 'design_render', ${userId}, ${brand}, ${status},
                      ${sql.json({ sequence: { frames }, image: { source: "none" } })},
                      ${sql.json(result)}, ${updatedAt})`;
    return id;
  }

  async function frame(setId: string, index: number, status: string) {
    const id = randomUUID();
    await sql`insert into design_generations (id, brand_id, user_id, source, spec, renderer, provider, model, status, set_id, frame_index, frame_count)
              values (${id}, ${brandId}, ${userId}, 'quick', '{}'::jsonb, 'composite', 'none', 'none',
                      ${status}, ${setId}, ${index}, 4)`;
    return id;
  }

  beforeAll(async () => {
    q = await import("./index");
    await sql`insert into users (id, first_name, last_name, email, email_verified_at)
              values (${userId}, 'Sets', 'Test', ${`sets-${userId}@qa.test`}, now())`;
    for (const [ws, brand] of [
      [workspaceId, brandId],
      [otherWorkspaceId, otherBrandId],
    ]) {
      await sql`insert into workspaces (id, name, owner_id, access_status)
                values (${ws}, 'Sets test', ${userId}, 'approved')`;
      await sql`insert into brands (id, user_id, workspace_id, name)
                values (${brand}, ${userId}, ${ws}, 'Crumb & Co.')`;
    }
  });

  beforeEach(async () => {
    await sql`delete from generation_jobs where user_id = ${userId}`;
    await sql`delete from design_generations where user_id = ${userId}`;
    await sql`delete from usage_events where user_id = ${userId}`;
  });

  afterAll(async () => {
    await sql`delete from users where id = ${userId}`;
    await sql.end({ timeout: 2 });
    process.env.DATABASE_URL = previousUrl;
  });

  it("reserves a set's frames until each lands or fails", async () => {
    const setId = randomUUID();
    await setJob({ frames: 4, setId });
    expect(
      await q.countReservedDesignUnitsForWorkspace(workspaceId, minutesAgo(10)),
    ).toBe(4);
    await frame(setId, 0, "succeeded");
    await frame(setId, 1, "failed");
    await frame(setId, 2, "pending");
    expect(
      await q.countReservedDesignUnitsForWorkspace(workspaceId, minutesAgo(10)),
    ).toBe(2);
  });

  it("reserves a set still planning, before its checkpoint names a set", async () => {
    await setJob({ frames: 7, setId: null });
    await setJob({ frames: 3, setId: randomUUID() });
    expect(
      await q.countReservedDesignUnitsForWorkspace(workspaceId, minutesAgo(10)),
    ).toBe(10);
  });

  it("reserves one unit for a frame regenerate in flight", async () => {
    await sql`insert into generation_jobs (kind, user_id, brand_id, status, input)
              values ('design_render', ${userId}, ${brandId}, 'running',
                      ${sql.json({ regenerateFrame: randomUUID(), edits: null })})`;
    expect(
      await q.countReservedDesignUnitsForWorkspace(workspaceId, minutesAgo(10)),
    ).toBe(1);
  });

  it("reserves nothing for finished, abandoned, other-workspace or single jobs", async () => {
    await setJob({ frames: 4, setId: randomUUID(), status: "succeeded" });
    await setJob({ frames: 4, setId: randomUUID(), updatedAt: minutesAgo(30) });
    await setJob({ frames: 4, setId: randomUUID(), brand: otherBrandId });
    await sql`insert into generation_jobs (kind, user_id, brand_id, status, input)
              values ('design_render', ${userId}, ${brandId}, 'running',
                      ${sql.json({ briefId: null, attachments: [] })})`;
    expect(
      await q.countReservedDesignUnitsForWorkspace(workspaceId, minutesAgo(10)),
    ).toBe(0);
  });

  it("fails only this workspace's silent frame jobs, and hands each back once", async () => {
    const abandoned = await setJob({
      frames: 4,
      setId: randomUUID(),
      updatedAt: minutesAgo(30),
    });
    await setJob({ frames: 4, setId: randomUUID() });
    await setJob({
      frames: 4,
      setId: randomUUID(),
      updatedAt: minutesAgo(30),
      brand: otherBrandId,
    });
    const [first, second] = await Promise.all([
      q.failAbandonedDesignJobs(workspaceId, minutesAgo(10), "stopped"),
      q.failAbandonedDesignJobs(workspaceId, minutesAgo(10), "stopped"),
    ]);
    const handedBack = [...first, ...second].map((j) => j.id);
    expect(handedBack).toEqual([abandoned]);
    const statuses = await sql`select status, error from generation_jobs
                               where user_id = ${userId} order by status`;
    expect(statuses.map((s) => s.status).sort()).toEqual([
      "failed",
      "running",
      "running",
    ]);
  });

  it("writes the set's outcome onto its frames' usage rows, not a regenerate's", async () => {
    const setId = randomUUID();
    for (const metadata of [
      { setId, generationId: "a", frameIndex: 0 },
      { setId, generationId: "b", frameIndex: 1 },
      { setId, generationId: "c", frameIndex: 1, regenerateOf: "b" },
      { setId: randomUUID(), generationId: "d", frameIndex: 0 },
    ]) {
      await q.recordUsageEvent({
        userId,
        brandId,
        kind: "design_generated",
        metadata,
      });
    }
    await q.annotateSetUsage(brandId, setId, {
      delivered: 2,
      jobFailed: false,
    });
    const rows = await sql`select metadata from usage_events
                           where user_id = ${userId}
                           order by metadata->>'generationId'`;
    expect(rows.map((r) => r.metadata.delivered ?? null)).toEqual([
      2,
      2,
      null,
      null,
    ]);
    expect(rows[0].metadata).toMatchObject({
      generationId: "a",
      frameIndex: 0,
    });
    expect(await q.listBilledSetGenerations(brandId, setId)).toHaveLength(3);
  });

  it("fails a regenerate's row only while it is still pending", async () => {
    const setId = randomUUID();
    const pending = await frame(setId, 1, "pending");
    const landed = await frame(setId, 2, "succeeded");
    await q.failPendingGeneration(pending, "stalled");
    await q.failPendingGeneration(landed, "stalled");
    const rows = await sql`select id, status, error from design_generations
                           where id in ${sql([pending, landed])}`;
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(pending)).toMatchObject({
      status: "failed",
      error: "stalled",
    });
    expect(byId.get(landed)).toMatchObject({
      status: "succeeded",
      error: null,
    });
  });
});
