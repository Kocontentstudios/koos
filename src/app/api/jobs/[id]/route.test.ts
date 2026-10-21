import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const getGenerationJobById = vi.fn();
const checkBrandAccess = vi.fn();
const claimPausedGenerationJob = vi.fn();
const claimStaleGenerationJob = vi.fn();
const updateGenerationJob = vi.fn();
const resumeCalendarJob = vi.fn();
const after = vi.fn();

vi.mock("next/server", () => ({ after: (fn: () => void) => after(fn) }));
vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  getGenerationJobById: (id: string) => getGenerationJobById(id),
  checkBrandAccess: (u: string, b: string, c: string) =>
    checkBrandAccess(u, b, c),
  claimPausedGenerationJob: (id: string) => claimPausedGenerationJob(id),
  claimStaleGenerationJob: (id: string, ms: number) =>
    claimStaleGenerationJob(id, ms),
  updateGenerationJob: (id: string, patch: unknown) =>
    updateGenerationJob(id, patch),
}));
vi.mock("@/lib/jobs/run-generation", () => ({
  resumeCalendarJob: (job: unknown) => resumeCalendarJob(job),
}));

import { WORKSPACE_PENDING_ERROR } from "@/lib/auth/workspace-approval";
import { GET } from "./route";

const JOB_ID = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const params = { params: Promise.resolve({ id: JOB_ID }) };
const req = new Request("http://x");

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: JOB_ID,
    kind: "calendar",
    userId: "u1",
    brandId: "b1",
    status: "running",
    result: { paused: true },
    updatedAt: new Date(),
    ...overrides,
  };
}

/* Revoking a workspace has to stop the spend it controls. A calendar job
   resumes slice by slice from this poll, so without a check here a revoked
   client's open tab keeps paying for every slice still to come. */
describe("GET /api/jobs/[id] and the access gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
    claimPausedGenerationJob.mockResolvedValue(job());
    resumeCalendarJob.mockResolvedValue(undefined);
  });

  it("fails a paused job instead of resuming it once the workspace is pending", async () => {
    getGenerationJobById.mockResolvedValue(job());
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: WORKSPACE_PENDING_ERROR,
    });

    const res = await GET(req, params);

    expect(await res.json()).toMatchObject({
      status: "failed",
      error: WORKSPACE_PENDING_ERROR,
    });
    expect(updateGenerationJob).toHaveBeenCalledWith(JOB_ID, {
      status: "failed",
      error: WORKSPACE_PENDING_ERROR,
    });
    expect(claimPausedGenerationJob).not.toHaveBeenCalled();
    expect(after).not.toHaveBeenCalled();
  });

  it("resumes a paused job while access holds", async () => {
    getGenerationJobById.mockResolvedValue(job());
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b1" } });

    await GET(req, params);

    expect(checkBrandAccess).toHaveBeenCalledWith("u1", "b1", "manage_content");
    expect(claimPausedGenerationJob).toHaveBeenCalledWith(JOB_ID);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("does not pay for an access check while a job is still running", async () => {
    getGenerationJobById.mockResolvedValue(
      job({ result: { progress: { step: 1 } } }),
    );

    const res = await GET(req, params);

    expect(res.status).toBe(200);
    expect(checkBrandAccess).not.toHaveBeenCalled();
  });

  it("withholds a finished result once the workspace is pending", async () => {
    getGenerationJobById.mockResolvedValue(
      job({ status: "succeeded", result: { strategyId: "s1" } }),
    );
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 403,
      error: WORKSPACE_PENDING_ERROR,
    });

    const res = await GET(req, params);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: WORKSPACE_PENDING_ERROR });
    expect(updateGenerationJob).not.toHaveBeenCalled();
  });

  it("hands over a finished result while access holds", async () => {
    getGenerationJobById.mockResolvedValue(
      job({ status: "succeeded", result: { strategyId: "s1" } }),
    );
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b1" } });

    const res = await GET(req, params);

    expect(await res.json()).toMatchObject({ result: { strategyId: "s1" } });
  });

  /* The poll's check and the claim are separate statements, so a revoke can
     land between them; the deferred work checks again before it spends. */
  it("re-checks access after the claim, right before resuming", async () => {
    getGenerationJobById.mockResolvedValue(job());
    checkBrandAccess
      .mockResolvedValueOnce({ ok: true, brand: { id: "b1" } })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        error: WORKSPACE_PENDING_ERROR,
      });

    await GET(req, params);
    const deferred = after.mock.calls[0][0] as () => Promise<void>;
    await deferred();

    expect(resumeCalendarJob).not.toHaveBeenCalled();
    expect(updateGenerationJob).toHaveBeenCalledWith(JOB_ID, {
      status: "failed",
      error: WORKSPACE_PENDING_ERROR,
    });
  });

  it("resumes from the deferred work when access still holds", async () => {
    getGenerationJobById.mockResolvedValue(job());
    checkBrandAccess.mockResolvedValue({ ok: true, brand: { id: "b1" } });

    await GET(req, params);
    await (after.mock.calls[0][0] as () => Promise<void>)();

    expect(resumeCalendarJob).toHaveBeenCalledTimes(1);
  });

  it("still 404s someone else's job before any access check", async () => {
    getGenerationJobById.mockResolvedValue(job({ userId: "someone-else" }));

    const res = await GET(req, params);

    expect(res.status).toBe(404);
    expect(checkBrandAccess).not.toHaveBeenCalled();
  });
});
