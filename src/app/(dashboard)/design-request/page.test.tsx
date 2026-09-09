import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Criterion: a design request must confirm a Brand Profile exists first.
   requireBrand() redirects to brand setup when onboarding is incomplete, so the
   guard is only real while this page actually calls it. Swapping it for a
   plain session check would otherwise leave every other test green. */
const { requireBrandMock, getDesignTicketsForMemberMock } = vi.hoisted(() => ({
  requireBrandMock: vi.fn(),
  getDesignTicketsForMemberMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-brand", () => ({
  requireBrand: requireBrandMock,
}));
vi.mock("@/lib/db/queries", () => ({
  getDesignTicketsForMember: getDesignTicketsForMemberMock,
}));

import DesignRequestPage from "./page";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("DesignRequestPage brand gate", () => {
  it("requires a completed brand profile before listing or starting requests", async () => {
    requireBrandMock.mockResolvedValue({
      dbUser: { id: "user-1" },
      workspace: { id: "ws-1" },
      role: "owner",
      brand: { id: "brand-1" },
    });
    getDesignTicketsForMemberMock.mockResolvedValue([]);

    await DesignRequestPage();

    expect(requireBrandMock).toHaveBeenCalled();
  });

  it("propagates the redirect when no brand profile exists", async () => {
    /* next/navigation's redirect() works by throwing; the page must not
       swallow it, or an unonboarded user would see the tickets page. */
    const redirectSignal = new Error("NEXT_REDIRECT");
    requireBrandMock.mockRejectedValue(redirectSignal);

    await expect(DesignRequestPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(getDesignTicketsForMemberMock).not.toHaveBeenCalled();
  });
});

describe("DesignRequestPage chooser wiring", () => {
  beforeEach(() => {
    requireBrandMock.mockResolvedValue({
      dbUser: { id: "user-1" },
      workspace: { id: "ws-1" },
      role: "owner",
      brand: { id: "brand-1" },
    });
  });

  /* The dialog's own suite renders it in isolation, so it stays green even if
     the page never mounts it. These assertions are the only thing standing
     between the feature and a revert to plain links. */
  it("does not route straight to the request form from the header CTA", async () => {
    getDesignTicketsForMemberMock.mockResolvedValue([]);
    const { container } = render(await DesignRequestPage());

    expect(container.querySelector('a[href="/design-request/new"]')).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "New Request" }));
    expect(
      screen.getByRole("heading", { name: "How do you want to start?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Choose from Content Calendar/ }),
    ).toBeInTheDocument();
  });

  it("opens the same chooser from the empty state", async () => {
    getDesignTicketsForMemberMock.mockResolvedValue([]);
    render(await DesignRequestPage());

    await userEvent.click(
      screen.getByRole("button", { name: "Request a Design" }),
    );
    expect(
      screen.getByRole("heading", { name: "How do you want to start?" }),
    ).toBeInTheDocument();
  });
});
