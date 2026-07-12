import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { WorkspaceCard } from "./workspace-card";

const owner = {
  id: "ws-1",
  name: "Acme Co",
  logoUrl: null,
  role: "owner" as const,
};
const member = {
  id: "ws-1",
  name: "Acme Co",
  logoUrl: null,
  role: "member" as const,
};

describe("WorkspaceCard", () => {
  it("shows the active workspace name and role on the trigger", () => {
    render(
      <WorkspaceCard collapsed={false} active={owner} memberships={[owner]} />,
    );
    expect(screen.getByText("Acme Co")).toBeInTheDocument();
    expect(screen.getByText("Owner")).toBeInTheDocument();
  });

  it("shows Workspace Settings for an owner", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceCard collapsed={false} active={owner} memberships={[owner]} />,
    );
    await user.click(screen.getByRole("button", { name: "Workspace menu" }));
    // Menu links get role="menuitem" (they're part of the ARIA menu widget,
    // not standalone navigation links).
    expect(
      await screen.findByRole("menuitem", { name: /Workspace Settings/i }),
    ).toBeInTheDocument();
  });

  it("hides Workspace Settings for a member", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceCard
        collapsed={false}
        active={member}
        memberships={[member]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Workspace menu" }));
    await screen.findByRole("menuitem", { name: /Team/i });
    expect(
      screen.queryByRole("menuitem", { name: /Workspace Settings/i }),
    ).not.toBeInTheDocument();
  });
});
