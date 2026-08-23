import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const setUserTourCompletedAt = vi.fn();
const captureServerEvent = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({
  getAuthUser: () => getAuthUser(),
}));
vi.mock("@/lib/db/queries", () => ({
  setUserTourCompletedAt: (id: string, at: Date | null) =>
    setUserTourCompletedAt(id, at),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: (e: unknown) => captureServerEvent(e),
}));
vi.mock("next/server", () => ({
  after: (fn: () => void) => fn(),
}));

import { POST } from "./route";

const USER = { id: "user-1" };

function request(body: unknown) {
  return new Request("http://localhost/api/tour/complete", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/tour/complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: USER });
    setUserTourCompletedAt.mockResolvedValue(USER);
  });

  it("rejects a signed-out caller without writing", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    const res = await POST(request({ reason: "skipped", stepIndex: 0 }));
    expect(res.status).toBe(401);
    expect(setUserTourCompletedAt).not.toHaveBeenCalled();
  });

  it("stamps the timestamp for the session user", async () => {
    const res = await POST(request({ reason: "completed", stepIndex: 6 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setUserTourCompletedAt).toHaveBeenCalledWith(
      "user-1",
      expect.any(Date),
    );
  });

  it("takes the user id from the session, never from the body", async () => {
    await POST(
      request({ reason: "skipped", stepIndex: 0, userId: "someone-else" }),
    );
    expect(setUserTourCompletedAt).toHaveBeenCalledWith(
      "user-1",
      expect.any(Date),
    );
  });

  it("still resolves the tour when the body is malformed", async () => {
    // Losing an analytics field must never cost the user a working dismissal.
    const res = await POST(
      new Request("http://localhost/api/tour/complete", {
        method: "POST",
        body: "not json",
      }),
    );
    expect(res.status).toBe(200);
    expect(setUserTourCompletedAt).toHaveBeenCalledWith(
      "user-1",
      expect.any(Date),
    );
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "product_tour_dismissed",
        properties: { reason: "unknown", step_index: null },
      }),
    );
  });

  it("separates completion from dismissal in analytics", async () => {
    await POST(request({ reason: "completed", stepIndex: 6 }));
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-1",
        event: "product_tour_completed",
      }),
    );
  });
});
