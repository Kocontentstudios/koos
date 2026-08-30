import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(dashboard)/brand/onboarding/welcome-card", () => ({
  WelcomeCard: ({ onboardingHref }: { onboardingHref: string }) => (
    <div data-testid="welcome-card" data-href={onboardingHref} />
  ),
}));

import { LockedDashboard } from "./locked-dashboard";

function renderLocked(onboardingHref = "/brand/onboarding") {
  render(<LockedDashboard firstName="Ada" onboardingHref={onboardingHref} />);
}

describe("LockedDashboard", () => {
  it("greets the user and says what is missing", () => {
    renderLocked();

    expect(screen.getByText("Welcome aboard, Ada")).toBeInTheDocument();
    expect(screen.getByText(/KO needs to learn it first/)).toBeInTheDocument();
  });

  it("points at onboarding", () => {
    renderLocked();
    expect(
      screen.getByRole("link", { name: "Set Up Your Brand" }),
    ).toHaveAttribute("href", "/brand/onboarding");
  });

  /* Someone part-way through the manual form should be sent back to it, not
     handed a chat that cannot see what they already typed. */
  it("resumes whichever onboarding path the brand was started on", () => {
    renderLocked("/brand/create");
    expect(
      screen.getByRole("link", { name: "Set Up Your Brand" }),
    ).toHaveAttribute("href", "/brand/create");
  });

  it("previews what the brand unlocks", () => {
    renderLocked();
    for (const title of [
      "Build a Strategy",
      "Generate Your Calendar",
      "Request a Design",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
  });

  /* A card that looks live and then redirects teaches the user not to trust
     the buttons, so the only thing clickable is the thing that unlocks them. */
  it("offers exactly one route forward and nothing else to click", () => {
    renderLocked();

    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("marks the previews as locked for assistive tech", () => {
    renderLocked();

    const locked = screen.getAllByRole("listitem");
    expect(locked.length).toBeGreaterThan(0);
    for (const item of locked) {
      expect(item).toHaveAttribute("aria-disabled", "true");
    }
    expect(screen.getAllByText("Locked").length).toBe(locked.length);
  });
});

/* The greeting moved here from /brand/onboarding: opening the dashboard means
   a brand-new user no longer passes through that route at all, so leaving the
   card there would have made it unreachable for exactly its audience. */
describe("LockedDashboard welcome card", () => {
  it("greets a first-time user", () => {
    render(
      <LockedDashboard
        firstName="Ada"
        onboardingHref="/brand/onboarding"
        showWelcome
      />,
    );
    expect(screen.getByTestId("welcome-card")).toHaveAttribute(
      "data-href",
      "/brand/onboarding",
    );
  });

  it("stays away once the card has been answered", () => {
    render(
      <LockedDashboard firstName="Ada" onboardingHref="/brand/onboarding" />,
    );
    expect(screen.queryByTestId("welcome-card")).not.toBeInTheDocument();
  });
});
