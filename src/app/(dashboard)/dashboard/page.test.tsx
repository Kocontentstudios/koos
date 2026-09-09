import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* The dashboard is the one guarded route a brand-less user may look at. Every
   other route keeps requireBrand, so this page's gate has to be tested here or
   nothing catches it opening too far. */
const {
  getActiveWorkspaceMock,
  getActiveBrandForMemberMock,
  canMock,
  redirectMock,
} = vi.hoisted(() => ({
  getActiveWorkspaceMock: vi.fn(),
  getActiveBrandForMemberMock: vi.fn(),
  canMock: vi.fn(),
  redirectMock: vi.fn(() => {
    // Next's redirect throws; a test that let execution continue past it would
    // assert against a page that never renders in production.
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/auth/redirects", () => ({
  redirectToLogin: () => {
    throw new Error("NEXT_REDIRECT_LOGIN");
  },
}));
vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: getActiveWorkspaceMock,
}));
vi.mock("@/lib/auth/workspace-access", () => ({ can: canMock }));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: getActiveBrandForMemberMock,
  getActiveCalendarForBrand: vi.fn(),
  getCalendarItems: vi.fn(),
  getDesignTicketsForMember: vi.fn(),
  getPendingInvitations: vi.fn(),
  getStrategiesByBrand: vi.fn(),
  getWorkspaceMembers: vi.fn(),
}));

import DashboardPage from "./page";

const searchParams = Promise.resolve({});

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWorkspaceMock.mockResolvedValue({
    dbUser: { id: "u1", firstName: "Ada", tourCompletedAt: null },
    workspace: { id: "ws-1" },
    role: "owner",
  });
  canMock.mockReturnValue(true);
});

describe("DashboardPage brand gate", () => {
  it.each([
    ["no brand at all", null],
    ["a draft brand", { onboardingStatus: "draft" }],
    ["a part-filled brand", { onboardingStatus: "in_progress" }],
  ])("shows the locked preview for %s", async (_label, brand) => {
    getActiveBrandForMemberMock.mockResolvedValue(brand);

    render(await DashboardPage({ searchParams }));

    expect(screen.getByText("Welcome aboard, Ada")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Set Up Your Brand" }),
    ).toBeInTheDocument();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  /* Resuming the path the brand was started on: a half-filled manual form
     must not be replaced by a chat that cannot see what was typed. */
  it("points the preview back at the path the brand was started on", async () => {
    getActiveBrandForMemberMock.mockResolvedValue({
      onboardingStatus: "draft",
      onboardingType: "manual",
    });

    render(await DashboardPage({ searchParams }));

    expect(
      screen.getByRole("link", { name: "Set Up Your Brand" }),
    ).toHaveAttribute("href", "/brand/create");
  });

  /* Someone who cannot create a brand has nothing to unlock, so they keep the
     existing dead-end rather than a preview they can never act on. */
  it("still sends a member who cannot create a brand to /no-brands", async () => {
    getActiveBrandForMemberMock.mockResolvedValue(null);
    canMock.mockReturnValue(false);

    await expect(DashboardPage({ searchParams })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(redirectMock).toHaveBeenCalledWith("/no-brands");
  });

  it("requires a session", async () => {
    getActiveWorkspaceMock.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });

    await expect(DashboardPage({ searchParams })).rejects.toThrow(
      "NEXT_REDIRECT_LOGIN",
    );
  });

  /* The preview must never run the brand-scoped queries — they take a brand id
     there is no brand to supply. */
  it("loads no brand data while locked", async () => {
    getActiveBrandForMemberMock.mockResolvedValue(null);
    const queries = await import("@/lib/db/queries");

    render(await DashboardPage({ searchParams }));

    expect(queries.getStrategiesByBrand).not.toHaveBeenCalled();
    expect(queries.getActiveCalendarForBrand).not.toHaveBeenCalled();
    expect(queries.getWorkspaceMembers).not.toHaveBeenCalled();
  });
});
