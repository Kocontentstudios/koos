import { beforeEach, describe, expect, it, vi } from "vitest";

const getActiveWorkspace = vi.fn();
const getWorkspaceMembers = vi.fn();
const getPendingInvitations = vi.fn();
const getBrandAccessByMember = vi.fn();
const getInvitationBrandsByInvitation = vi.fn();

vi.mock("@/lib/auth/workspace", () => ({
  getActiveWorkspace: () => getActiveWorkspace(),
}));
vi.mock("@/lib/db/queries", () => ({
  getWorkspaceMembers: (w: string) => getWorkspaceMembers(w),
  getPendingInvitations: (w: string) => getPendingInvitations(w),
  getBrandAccessByMember: (w: string) => getBrandAccessByMember(w),
  getInvitationBrandsByInvitation: (w: string) =>
    getInvitationBrandsByInvitation(w),
}));

import { GET } from "./route";

const MEMBER_ROW = {
  membershipId: "m1",
  role: "brand_manager",
  brandScope: "assigned",
  joinedAt: new Date(),
  user: {
    id: "u9",
    firstName: "Bo",
    lastName: "M",
    email: "bo@example.com",
    avatarUrl: null,
  },
};

describe("GET /api/workspace/members", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWorkspaceMembers.mockResolvedValue([MEMBER_ROW]);
    getPendingInvitations.mockResolvedValue([
      {
        id: "inv1",
        email: "new@example.com",
        role: "contributor",
        brandScope: "assigned",
        createdAt: new Date(),
        expiresAt: new Date(),
      },
    ]);
    getBrandAccessByMember.mockResolvedValue(
      new Map([["u9", ["secret-brand"]]]),
    );
    getInvitationBrandsByInvitation.mockResolvedValue(
      new Map([["inv1", ["secret-brand"]]]),
    );
  });

  function signedInAs(role: string) {
    getActiveWorkspace.mockResolvedValue({
      dbUser: { id: "u1" },
      workspace: { id: "w1", ownerId: "u1" },
      role,
    });
  }

  it("returns 401 when signed out", async () => {
    getActiveWorkspace.mockResolvedValue({
      dbUser: null,
      workspace: null,
      role: null,
    });
    expect((await GET()).status).toBe(401);
  });

  it("shows assignments to someone who can change them", async () => {
    signedInAs("owner");
    const body = await (await GET()).json();
    expect(body.members[0].assignedBrandIds).toEqual(["secret-brand"]);
    expect(body.invitations[0].assignedBrandIds).toEqual(["secret-brand"]);
  });

  /* The roster itself is deliberately readable by every member, but the brand
     ids behind it are not: they name brands the viewer cannot reach, and a
     brand id is the input every other route accepts. */
  it("redacts assignment brand ids from a contributor", async () => {
    signedInAs("contributor");
    const body = await (await GET()).json();
    expect(body.members[0].assignedBrandIds).toEqual([]);
    expect(body.invitations[0].assignedBrandIds).toEqual([]);
    // The roster itself still comes back.
    expect(body.members[0].user.email).toBe("bo@example.com");
  });

  it("redacts them from a brand manager too", async () => {
    signedInAs("brand_manager");
    const body = await (await GET()).json();
    expect(body.members[0].assignedBrandIds).toEqual([]);
  });
});
