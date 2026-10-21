import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { refresh, toast } = vi.hoisted(() => ({
  refresh: vi.fn(),
  toast: {
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast }));

import {
  type WorkspaceAccessRow,
  WorkspaceAccessTable,
} from "./workspace-access-table";

const PENDING: WorkspaceAccessRow = {
  id: "w-pending",
  name: "Killa Skincare",
  accessStatus: "pending",
  ownerName: "Ada Obi",
  ownerEmail: "ada@killa.com",
  signedUpAt: "2026-10-18T09:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
};
const OTHER_PENDING: WorkspaceAccessRow = {
  ...PENDING,
  id: "w-other",
  name: "Acme",
};
const APPROVED: WorkspaceAccessRow = {
  ...PENDING,
  id: "w-approved",
  name: "Northwind",
  accessStatus: "approved",
  decidedAt: "2026-10-19T09:00:00.000Z",
  decidedBy: "Sam Admin",
};

function respond(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body });
}

afterEach(cleanup);

describe("WorkspaceAccessTable", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows who decided, and marks grandfathered workspaces", () => {
    render(
      <WorkspaceAccessTable
        rows={[
          APPROVED,
          { ...APPROVED, id: "old", decidedBy: null, decidedAt: null },
        ]}
      />,
    );
    expect(screen.getByText(/Approved by Sam Admin/)).toBeInTheDocument();
    expect(screen.getByText("Approved before the gate")).toBeInTheDocument();
  });

  it("approves and confirms the owner was emailed", async () => {
    global.fetch = respond({ changed: true, emailSent: true });
    render(<WorkspaceAccessTable rows={[PENDING]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Approve Killa Skincare" }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/workspaces/w-pending/access",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ status: "approved" }),
      }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  /* An approved client who was never told is a client waiting on a call that
     already happened; the admin has to hear it to follow up by hand. */
  it("warns when the approval email did not send", async () => {
    global.fetch = respond({ changed: true, emailSent: false });
    render(<WorkspaceAccessTable rows={[PENDING]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Approve Killa Skincare" }),
    );
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("marks only the row being approved as working", async () => {
    let finish: (v: unknown) => void = () => {};
    global.fetch = vi.fn(
      () =>
        new Promise<Response>((r) => {
          finish = r as (v: unknown) => void;
        }),
    );
    render(<WorkspaceAccessTable rows={[PENDING, OTHER_PENDING]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Approve Killa Skincare" }),
    );

    const acting = await screen.findByRole("button", { name: /Approving/ });
    expect(acting).toHaveAttribute("aria-busy", "true");
    const other = screen.getByRole("button", { name: "Approve Acme" });
    expect(other).not.toHaveAttribute("aria-busy", "true");
    expect(other).toBeDisabled();

    finish({
      ok: true,
      json: async () => ({ changed: true, emailSent: true }),
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
  });

  it("asks before revoking, and does nothing on cancel", async () => {
    global.fetch = respond({ changed: true });
    render(<WorkspaceAccessTable rows={[APPROVED]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke access for Northwind" }),
    );
    expect(
      await screen.findByText("Revoke access for Northwind?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("revokes once confirmed", async () => {
    global.fetch = respond({ changed: true });
    render(<WorkspaceAccessTable rows={[APPROVED]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Revoke access for Northwind" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Revoke access" }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Access revoked for Northwind",
      ),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/workspaces/w-approved/access",
      expect.objectContaining({ body: JSON.stringify({ status: "pending" }) }),
    );
  });

  it("surfaces the server's error", async () => {
    global.fetch = respond({ error: "Forbidden" }, false);
    render(<WorkspaceAccessTable rows={[PENDING]} />);
    fireEvent.click(
      screen.getByRole("button", { name: "Approve Killa Skincare" }),
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Forbidden"));
  });

  it("says so when there are no workspaces", () => {
    render(<WorkspaceAccessTable rows={[]} />);
    expect(screen.getByText("No workspaces yet.")).toBeInTheDocument();
  });
});
