import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TeamClient } from "./team-client";

const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

afterEach(() => {
  refreshMock.mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const brands = [
  { id: "b1", name: "Acme" },
  { id: "b2", name: "Globex" },
];

const members = [
  {
    userId: "owner-1",
    name: "Precious Oyenuga",
    email: "precious@example.com",
    avatarUrl: null,
    role: "owner" as const,
    brandScope: "all" as const,
    assignedBrandIds: [] as string[],
  },
  {
    userId: "member-1",
    name: "Sarah Kim",
    email: "sarah@example.com",
    avatarUrl: null,
    role: "contributor" as const,
    brandScope: "all" as const,
    assignedBrandIds: [] as string[],
  },
];

const invitations = [
  {
    id: "inv-1",
    email: "james@example.com",
    role: "contributor" as const,
    brandScope: "all" as const,
    assignedBrandIds: [] as string[],
    expiresAt: new Date().toISOString(),
  },
];

describe("TeamClient", () => {
  it("renders read-only for members without manage_team: no invite/remove/resend/revoke controls", async () => {
    const user = userEvent.setup();
    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="member-1"
        viewerRole="contributor"
        viewerBrandScope="all"
        canManage={false}
        canInvite={false}
        canManageBrandAccess={false}
        brands={brands}
        members={members}
        invitations={invitations}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /invite team/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /remove/i }),
    ).not.toBeInTheDocument();

    // Still renders the member roster read-only.
    expect(screen.getByText("Sarah Kim")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();

    // Pending tab's panel is unmounted until active — switch to it before
    // asserting Resend/Revoke are absent, otherwise the check is vacuous.
    await user.click(screen.getByRole("tab", { name: /pending/i }));
    expect(
      (await screen.findAllByText("james@example.com")).length,
    ).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /resend/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /revoke/i }),
    ).not.toBeInTheDocument();
  });

  it("shows management controls for a user who can manage the team", () => {
    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="owner-1"
        viewerRole="owner"
        viewerBrandScope="all"
        canManage={true}
        canInvite={true}
        canManageBrandAccess={true}
        brands={brands}
        members={members}
        invitations={invitations}
      />,
    );

    expect(
      screen.getByRole("button", { name: /invite team/i }),
    ).toBeInTheDocument();
    // Owner row (self) has no Remove button, only the "You" label.
    expect(screen.getAllByText("You")).toHaveLength(1);
    // Sarah Kim (not self) is removable.
    expect(screen.getByRole("button", { name: /remove/i })).toBeInTheDocument();
  });

  it("surfaces the server's error message in the invite dialog and keeps it open", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "This email has already been invited." }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="owner-1"
        viewerRole="owner"
        viewerBrandScope="all"
        canManage={true}
        canInvite={true}
        canManageBrandAccess={true}
        brands={brands}
        members={members}
        invitations={invitations}
      />,
    );

    await user.click(screen.getByRole("button", { name: /invite team/i }));
    await user.type(
      screen.getByLabelText(/email address/i),
      "james@example.com",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(
      await screen.findByText("This email has already been invited."),
    ).toBeInTheDocument();
    // Dialog stays open on error.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("closes the invite dialog and refreshes on a successful invite", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="owner-1"
        viewerRole="owner"
        viewerBrandScope="all"
        canManage={true}
        canInvite={true}
        canManageBrandAccess={true}
        brands={brands}
        members={members}
        invitations={invitations}
      />,
    );

    await user.click(screen.getByRole("button", { name: /invite team/i }));
    await user.type(
      screen.getByLabelText(/email address/i),
      "newperson@example.com",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(refreshMock).toHaveBeenCalled();

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace/invitations",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      email: "newperson@example.com",
      role: "contributor",
      brandIds: [],
    });
  });

  it("falls back to a generic message when the error response isn't JSON", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error("nope");
      },
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="owner-1"
        viewerRole="owner"
        viewerBrandScope="all"
        canManage={true}
        canInvite={true}
        canManageBrandAccess={true}
        brands={brands}
        members={members}
        invitations={invitations}
      />,
    );

    await user.click(screen.getByRole("button", { name: /invite team/i }));
    await user.type(
      screen.getByLabelText(/email address/i),
      "james@example.com",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(
      await screen.findByText("Something went wrong. Please try again."),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("confirms removal, hits the DELETE endpoint, refreshes, and closes the dialog", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="owner-1"
        viewerRole="owner"
        viewerBrandScope="all"
        canManage={true}
        canInvite={true}
        canManageBrandAccess={true}
        brands={brands}
        members={members}
        invitations={invitations}
      />,
    );

    // Sarah Kim (member-1) is the only removable row (owner is self).
    await user.click(screen.getByRole("button", { name: /remove/i }));

    expect(
      await screen.findByRole("heading", { name: /remove sarah kim\?/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /remove member/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(refreshMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/workspace/members/member-1",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

describe("TeamClient — a brand-scoped inviter", () => {
  const scopedProps = {
    workspaceName: "KO Content Studio",
    currentUserId: "bm-1",
    viewerRole: "brand_manager" as const,
    viewerBrandScope: "assigned" as const,
    canManage: false,
    canInvite: true,
    canManageBrandAccess: false,
    brands,
    members,
    invitations,
  };

  it("offers only Contributor, never a peer or a superior", async () => {
    const user = userEvent.setup();
    render(<TeamClient {...scopedProps} />);
    await user.click(screen.getByRole("button", { name: /invite team/i }));
    expect(await screen.findByText("Contributor")).toBeInTheDocument();
    expect(screen.queryByText("Workspace Admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Brand Manager")).not.toBeInTheDocument();
  });

  /* Escalation guard, mirrored in the UI: a scoped inviter can never send an
     unscoped invite, so the brand picker is mandatory and cannot be toggled
     off the way a workspace-wide admin can. */
  it("forces the brand picker and hides the opt-out toggle", async () => {
    const user = userEvent.setup();
    render(<TeamClient {...scopedProps} />);
    await user.click(screen.getByRole("button", { name: /invite team/i }));
    expect(await screen.findByText("Acme")).toBeInTheDocument();
    expect(
      screen.queryByText(/limit to specific brands/i),
    ).not.toBeInTheDocument();
  });

  it("refuses to send with no brand chosen", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<TeamClient {...scopedProps} />);
    await user.click(screen.getByRole("button", { name: /invite team/i }));
    await user.type(
      await screen.findByLabelText(/email address/i),
      "new@example.com",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));
    expect(
      await screen.findByText(/choose at least one brand/i),
    ).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("TeamClient — per-row pending state", () => {
  const twoInvites = [
    invitations[0],
    {
      id: "inv-2",
      email: "ada@example.com",
      role: "contributor" as const,
      brandScope: "all" as const,
      assignedBrandIds: [] as string[],
      expiresAt: new Date().toISOString(),
    },
  ];

  function renderTeam() {
    render(
      <TeamClient
        workspaceName="KO Content Studio"
        currentUserId="owner-1"
        viewerRole="owner"
        viewerBrandScope="all"
        canManage={true}
        canInvite={true}
        canManageBrandAccess={true}
        brands={brands}
        members={members}
        invitations={twoInvites}
      />,
    );
  }

  /* Regression: `pending` is one boolean for the whole component, so keying the
     row buttons on it made every Resend and Revoke spin at once — the UI
     claiming four things were processing when one was. */
  it("spins only the invitation row being acted on", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<never>(() => {})),
    );
    renderTeam();

    await user.click(screen.getByRole("tab", { name: /pending/i }));
    const revokes = await screen.findAllByRole("button", { name: /^revoke$/i });
    expect(revokes).toHaveLength(2);

    await user.click(revokes[0]);

    // Exactly one button announces work; the other row stays silent.
    expect(
      await screen.findAllByRole("button", { name: /revoking…/i }),
    ).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^revoke$/i })).toHaveLength(
      1,
    );
    // No Resend claims to be resending either.
    expect(
      screen.queryByRole("button", { name: /resending…/i }),
    ).not.toBeInTheDocument();

    vi.unstubAllGlobals();
  });

  /* Spinning one row must still lock the others — `loading` says "I am
     working", `disabled` says "wait"; they are not the same signal. */
  it("locks every other row while one is in flight", async () => {
    const user = (await import("@testing-library/user-event")).default.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<never>(() => {})),
    );
    renderTeam();

    await user.click(screen.getByRole("tab", { name: /pending/i }));
    const revokes = await screen.findAllByRole("button", { name: /^revoke$/i });
    await user.click(revokes[0]);

    for (const b of screen.getAllByRole("button", { name: /^revoke$/i })) {
      expect(b).toBeDisabled();
    }
    for (const b of screen.getAllByRole("button", { name: /^resend$/i })) {
      expect(b).toBeDisabled();
    }

    vi.unstubAllGlobals();
  });
});
