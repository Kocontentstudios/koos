import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const startConversationalOnboarding = vi.fn();
const refresh = vi.fn();
const toastError = vi.fn();

vi.mock("./actions", () => ({
  startConversationalOnboarding: () => startConversationalOnboarding(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m) } }));

import { OnboardingStart } from "./onboarding-start";

describe("OnboardingStart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    startConversationalOnboarding.mockResolvedValue({
      ok: true,
      brandId: "b1",
    });
  });

  /* The whole point of the fix: a brand-new user lands on an offer to chat,
     not on the seven-step form. */
  it("offers to start with KO", () => {
    render(<OnboardingStart />);
    expect(
      screen.getByRole("button", { name: /start with ko/i }),
    ).toBeInTheDocument();
  });

  it("keeps the manual form reachable as an explicit choice", () => {
    render(<OnboardingStart />);
    expect(
      screen.getByRole("link", { name: /fill in the form instead/i }),
    ).toHaveAttribute("href", "/brand/create");
  });

  it("creates the draft brand and re-renders into the chat", async () => {
    render(<OnboardingStart />);
    await userEvent.click(
      screen.getByRole("button", { name: /start with ko/i }),
    );
    expect(startConversationalOnboarding).toHaveBeenCalledOnce();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("surfaces the error and never refreshes when the action is refused", async () => {
    startConversationalOnboarding.mockResolvedValue({
      ok: false,
      error: "You need workspace admin access to add a brand.",
    });
    render(<OnboardingStart />);
    await userEvent.click(
      screen.getByRole("button", { name: /start with ko/i }),
    );
    expect(toastError).toHaveBeenCalledWith(
      "You need workspace admin access to add a brand.",
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
