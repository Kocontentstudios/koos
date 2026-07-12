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

const members = [
  {
    userId: "owner-1",
    name: "Precious Oyenuga",
    email: "precious@example.com",
    avatarUrl: null,
    role: "owner" as const,
  },
  {
    userId: "member-1",
    name: "Sarah Kim",
    email: "sarah@example.com",
    avatarUrl: null,
    role: "member" as const,
  },
];

const invitations = [
  {
    id: "inv-1",
    email: "james@example.com",
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
        canManage={false}
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
        canManage={true}
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
        canManage={true}
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
        canManage={true}
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
        canManage={true}
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
        canManage={true}
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
