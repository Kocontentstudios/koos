import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthUser = vi.fn();
const setUserWelcomeSeenAt = vi.fn();
const captureServerEvent = vi.fn();

vi.mock("@/lib/auth/get-user", () => ({ getAuthUser: () => getAuthUser() }));
vi.mock("@/lib/db/queries", () => ({
  setUserWelcomeSeenAt: (id: string, at: Date) => setUserWelcomeSeenAt(id, at),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: (e: unknown) => captureServerEvent(e),
}));
vi.mock("next/server", () => ({ after: (fn: () => void) => fn() }));

import { POST } from "./route";

const post = (body: unknown) =>
  new Request("http://x/api/welcome/dismiss", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/welcome/dismiss", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthUser.mockResolvedValue({ dbUser: { id: "u1" } });
  });

  it.each(["start", "later"] as const)(
    "records the %s choice against the user",
    async (action) => {
      const res = await POST(post({ action }));

      expect(res.status).toBe(200);
      expect(setUserWelcomeSeenAt).toHaveBeenCalledWith("u1", expect.any(Date));
      expect(captureServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          distinctId: "u1",
          event: "welcome_card_dismissed",
          properties: { action },
        }),
      );
    },
  );

  it("requires a session", async () => {
    getAuthUser.mockResolvedValue({ dbUser: null });
    expect((await POST(post({ action: "later" }))).status).toBe(401);
    expect(setUserWelcomeSeenAt).not.toHaveBeenCalled();
  });

  /* The gate is "welcome_seen_at IS NULL", so a body we cannot parse must
     still resolve it — losing the analytics label is cheaper than trapping
     the user behind a modal that returns on every load. */
  it("still records the dismissal when the body is unusable", async () => {
    expect((await POST(post("not json"))).status).toBe(200);
    expect(setUserWelcomeSeenAt).toHaveBeenCalledWith("u1", expect.any(Date));
    expect(captureServerEvent).toHaveBeenCalledWith(
      expect.objectContaining({ properties: { action: "unknown" } }),
    );
  });

  it("still records the dismissal for an unrecognised action", async () => {
    expect((await POST(post({ action: "sideways" }))).status).toBe(200);
    expect(setUserWelcomeSeenAt).toHaveBeenCalledWith("u1", expect.any(Date));
  });
});
