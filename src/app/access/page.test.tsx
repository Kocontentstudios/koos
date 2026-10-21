import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getWorkspacesForUser = vi.fn();
const redirect = vi.fn((to: string) => {
  throw new Error(`REDIRECT ${to}`);
});

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getWorkspacesForUser: (id: string) => getWorkspacesForUser(id),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: vi.fn(),
  identifyUser: vi.fn(),
}));

import AccessPage from "./page";

const PENDING = {
  dbUser: { id: "u1", role: "user", email: "ada@killa.com" },
  workspace: {
    id: "personal",
    name: "Ada's Workspace",
    accessStatus: "pending",
  },
  role: "owner",
};

function membership(id: string, name: string, accessStatus: string) {
  return { workspaceId: id, workspace: { id, name, accessStatus } };
}

afterEach(cleanup);

describe("/access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspacesForUser.mockResolvedValue([
      membership("personal", "Ada's Workspace", "pending"),
    ]);
  });

  it("sends a signed-out visitor to login", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });
    await expect(AccessPage()).rejects.toThrow("REDIRECT /api/auth/clear");
  });

  it("sends an approved workspace straight to the dashboard", async () => {
    getActiveWorkspace.mockResolvedValue({
      ...PENDING,
      workspace: { ...PENDING.workspace, accessStatus: "approved" },
    });
    await expect(AccessPage()).rejects.toThrow("REDIRECT /dashboard");
  });

  it("sends staff straight to the dashboard", async () => {
    getActiveWorkspace.mockResolvedValue({
      ...PENDING,
      dbUser: { ...PENDING.dbUser, role: "admin" },
    });
    await expect(AccessPage()).rejects.toThrow("REDIRECT /dashboard");
  });

  it("renders the gate for a pending workspace", async () => {
    getActiveWorkspace.mockResolvedValue(PENDING);
    render(await AccessPage());
    expect(screen.getByRole("link", { name: /book a call/i })).toBeVisible();
  });

  /* Only approved workspaces are offered, and never the one already active:
     offering a second pending workspace would just reload this page. */
  it("offers only the other approved workspaces", async () => {
    getActiveWorkspace.mockResolvedValue(PENDING);
    getWorkspacesForUser.mockResolvedValue([
      membership("personal", "Ada's Workspace", "pending"),
      membership("client", "Killa Skincare", "approved"),
      membership("other", "Another Pending", "pending"),
    ]);
    render(await AccessPage());
    expect(
      screen.getByRole("button", { name: "Open Killa Skincare" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Another Pending/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Ada's Workspace/ }),
    ).not.toBeInTheDocument();
  });
});
