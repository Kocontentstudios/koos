import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

// Test data for workspace switching (distinct ids)
const activeWorkspace = {
  id: "ws-a",
  name: "Workspace A",
  logoUrl: null,
  role: "owner" as const,
};
const otherWorkspace = {
  id: "ws-b",
  name: "Workspace B",
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

  describe("workspace switching", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let assignMock: ReturnType<typeof vi.fn>;
    let originalLocation: Location;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal("fetch", fetchMock);

      assignMock = vi.fn();
      originalLocation = window.location;
      Object.defineProperty(window, "location", {
        value: { ...originalLocation, assign: assignMock },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      vi.clearAllMocks();
      vi.unstubAllGlobals?.();
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it("switches to another workspace and hard-reloads on success", async () => {
      const user = userEvent.setup();

      render(
        <WorkspaceCard
          collapsed={false}
          active={activeWorkspace}
          memberships={[activeWorkspace, otherWorkspace]}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Workspace menu" }));
      const otherItem = await screen.findByRole("menuitem", {
        name: /Workspace B/i,
      });
      await user.click(otherItem);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith("/api/workspace/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: "ws-b" }),
        });
      });

      await waitFor(() => {
        expect(assignMock).toHaveBeenCalledWith("/dashboard");
      });
    });

    it("does not switch when clicking the active workspace", async () => {
      const user = userEvent.setup();

      render(
        <WorkspaceCard
          collapsed={false}
          active={activeWorkspace}
          memberships={[activeWorkspace, otherWorkspace]}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Workspace menu" }));
      const activeItem = await screen.findByRole("menuitem", {
        name: /Workspace A/i,
      });
      await user.click(activeItem);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(assignMock).not.toHaveBeenCalled();
    });

    it("does not reload when workspace switch fails", async () => {
      fetchMock.mockResolvedValue({ ok: false });
      const user = userEvent.setup();

      render(
        <WorkspaceCard
          collapsed={false}
          active={activeWorkspace}
          memberships={[activeWorkspace, otherWorkspace]}
        />,
      );

      await user.click(screen.getByRole("button", { name: "Workspace menu" }));
      const otherItem = await screen.findByRole("menuitem", {
        name: /Workspace B/i,
      });
      await user.click(otherItem);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith("/api/workspace/switch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ workspaceId: "ws-b" }),
        });
      });

      expect(assignMock).not.toHaveBeenCalled();
    });
  });
});
