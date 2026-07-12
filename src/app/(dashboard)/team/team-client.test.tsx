import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TeamClient } from "./team-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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
});
