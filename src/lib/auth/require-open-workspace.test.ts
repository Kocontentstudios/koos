import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
}));

import { requireOpenWorkspace } from "./require-open-workspace";

describe("requireOpenWorkspace", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends a signed-out visitor to login", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });
    await expect(requireOpenWorkspace()).rejects.toThrow(
      "REDIRECT /api/auth/clear",
    );
  });

  it("sends a pending workspace to the access gate", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1", role: "user" },
      workspace: { id: "w1", accessStatus: "pending" },
      role: "owner",
    });
    await expect(requireOpenWorkspace()).rejects.toThrow("REDIRECT /access");
  });

  it("returns the workspace when it is approved", async () => {
    const ok = {
      dbUser: { id: "u1", role: "user" },
      workspace: { id: "w1", accessStatus: "approved" },
      role: "owner",
    };
    getActiveWorkspace.mockResolvedValue(ok);
    await expect(requireOpenWorkspace()).resolves.toBe(ok);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("lets a designer into a pending workspace", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1", role: "designer" },
      workspace: { id: "w1", accessStatus: "pending" },
      role: "owner",
    });
    await expect(requireOpenWorkspace()).resolves.toBeTruthy();
  });
});
