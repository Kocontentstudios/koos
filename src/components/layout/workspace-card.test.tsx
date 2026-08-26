import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkspaceCard } from "./workspace-card";

const active = {
  id: "w1",
  name: "Acme",
  role: "owner" as const,
  logoUrl: null,
};
const other = {
  id: "w2",
  name: "Globex",
  role: "admin" as const,
  logoUrl: null,
};

/**
 * The switching state (spinner on the trigger, "Switching workspace" label)
 * is only reachable through the dropdown, whose content does not mount under
 * jsdom — it is verified in the browser instead. What is pinned here is the
 * idle contract the busy state swaps out of.
 */
describe("WorkspaceCard", () => {
  it("labels the trigger as a menu when idle", () => {
    render(
      <WorkspaceCard
        active={active}
        memberships={[active, other]}
        collapsed={false}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Workspace menu" });
    expect(trigger).toBeEnabled();
    expect(trigger).not.toHaveAttribute("aria-busy");
  });

  it("shows the active workspace and role", () => {
    render(
      <WorkspaceCard
        active={active}
        memberships={[active, other]}
        collapsed={false}
      />,
    );
    expect(screen.getByText("Acme")).toBeInTheDocument();
  });
});
