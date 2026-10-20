import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const captureEvent = vi.fn();
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (e: string, p: unknown) => captureEvent(e, p),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { BOOK_CALL_URL } from "@/lib/auth/workspace-approval";
import { AccessGate } from "./access-gate";
import { OFFERS } from "./offers";

afterEach(cleanup);

function renderGate(openWorkspaces: { id: string; name: string }[] = []) {
  return render(
    <AccessGate
      workspaceId="w1"
      email="ada@killa.com"
      openWorkspaces={openWorkspaces}
    />,
  );
}

describe("AccessGate", () => {
  it("says the account is pending approval", () => {
    renderGate();
    expect(
      screen.getByText("Account access · Pending approval"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Everything your brand needs, in one workspace.",
      }),
    ).toBeInTheDocument();
  });

  it("lists every offer from the mock", () => {
    renderGate();
    const grid = screen.getByRole("region", { name: "What KO OS offers" });
    const titles = within(grid)
      .getAllByRole("heading", { level: 2 })
      .map((h) => h.textContent);
    expect(titles).toEqual(OFFERS.map((o) => o.title));
    expect(titles).toHaveLength(8);
  });

  it("books the call on cal.com in a new tab without leaking the opener", () => {
    renderGate();
    const link = screen.getByRole("link", { name: /book a call/i });
    expect(link).toHaveAttribute("href", BOOK_CALL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("traces the view and the click, so the gate's conversion is measurable", () => {
    renderGate();
    expect(captureEvent).toHaveBeenCalledWith("access_gate_viewed", {
      workspaceId: "w1",
    });
    screen.getByRole("link", { name: /book a call/i }).click();
    expect(captureEvent).toHaveBeenCalledWith("access_book_call_clicked", {
      workspaceId: "w1",
    });
  });

  it("does not promise that booking unlocks the account", () => {
    renderGate();
    expect(
      screen.getByText(/Booking a call does not unlock your account/),
    ).toBeInTheDocument();
  });

  it("shows which account is signed in", () => {
    renderGate();
    expect(screen.getByText("Signed in as ada@killa.com")).toBeInTheDocument();
  });

  it("offers no workspace switch when there is nowhere approved to go", () => {
    renderGate();
    expect(
      screen.queryByRole("heading", { name: /access elsewhere/i }),
    ).not.toBeInTheDocument();
  });

  it("offers each approved workspace the person already belongs to", () => {
    renderGate([
      { id: "c1", name: "Killa Skincare" },
      { id: "c2", name: "Acme" },
    ]);
    expect(
      screen.getByRole("heading", { name: /access elsewhere/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Killa Skincare" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Open Acme" }),
    ).toBeInTheDocument();
  });
});
