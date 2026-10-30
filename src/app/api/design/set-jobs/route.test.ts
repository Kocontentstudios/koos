import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const checkBrandAccess = vi.fn();
const listOpenSetJobs = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  checkBrandAccess: (...a: unknown[]) => checkBrandAccess(...a),
}));
vi.mock("@/lib/design/sequence/open-set-jobs.server", () => ({
  listOpenSetJobs: (...a: unknown[]) => listOpenSetJobs(...a),
}));

import { GET } from "./route";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const call = (qs = `?brandId=${BRAND}`) =>
  GET(new Request(`http://x/api/design/set-jobs${qs}`));

const JOB = {
  jobId: "job-1",
  kind: "set",
  sequenceKind: "carousel",
  setId: null,
  startedAt: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  checkBrandAccess.mockResolvedValue({ ok: true });
  listOpenSetJobs.mockResolvedValue([JOB]);
});

describe("GET /api/design/set-jobs", () => {
  it("lists the caller's open set jobs for the brand", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobs: [JOB] });
    expect(listOpenSetJobs).toHaveBeenCalledWith("u1", BRAND);
    expect(checkBrandAccess).toHaveBeenCalledWith(
      "u1",
      BRAND,
      "manage_content",
    );
  });

  it("refuses a caller who is not signed in", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await call()).status).toBe(401);
    expect(listOpenSetJobs).not.toHaveBeenCalled();
  });

  it.each(["", "?brandId=nope"])("refuses a bad brand id (%j)", async (qs) => {
    expect((await call(qs)).status).toBe(400);
    expect(listOpenSetJobs).not.toHaveBeenCalled();
  });

  it("says nothing of a brand the caller cannot manage", async () => {
    checkBrandAccess.mockResolvedValue({
      ok: false,
      status: 404,
      error: "Brand not found",
    });
    const res = await call();
    expect(res.status).toBe(404);
    expect(listOpenSetJobs).not.toHaveBeenCalled();
  });
});
