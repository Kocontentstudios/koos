import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { WelcomeCard } from "./welcome-card";

const ok = async () => ({ ok: true, json: async () => ({ ok: true }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(ok));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The action recorded on /api/welcome/dismiss for the nth call. */
function dismissAction(index = 0) {
  const mock = fetch as unknown as { mock: { calls: unknown[][] } };
  const [url, init] = mock.mock.calls[index] as [string, RequestInit];
  expect(url).toBe("/api/welcome/dismiss");
  return JSON.parse(String(init.body)).action;
}

describe("WelcomeCard", () => {
  it("greets the user with both routes forward", () => {
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    expect(screen.getByText("Welcome to KO OS")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Set Up Your Brand" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Maybe later" }),
    ).toBeInTheDocument();
  });

  it("starts onboarding and records the choice", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    await user.click(screen.getByRole("button", { name: "Set Up Your Brand" }));

    expect(push).toHaveBeenCalledWith("/brand/onboarding");
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(dismissAction()).toBe("start");
  });

  /* Both CTAs answer the question, so both must close it for good — otherwise
     "Maybe later" greets the user again on every reload. */
  it("records a deferral too, and does not start onboarding", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    await user.click(screen.getByRole("button", { name: "Maybe later" }));

    expect(push).not.toHaveBeenCalled();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(dismissAction()).toBe("later");
  });

  it("closes on either choice", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    await user.click(screen.getByRole("button", { name: "Maybe later" }));
    await waitFor(() =>
      expect(screen.queryByText("Welcome to KO OS")).not.toBeInTheDocument(),
    );
  });

  /* A failed write should cost a repeat greeting, never a modal the user
     cannot escape. */
  it("still closes when the dismissal fails to record", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    await user.click(screen.getByRole("button", { name: "Maybe later" }));
    await waitFor(() =>
      expect(screen.queryByText("Welcome to KO OS")).not.toBeInTheDocument(),
    );
  });

  it("records a deferral when dismissed by the overlay or Escape", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(dismissAction()).toBe("later");
  });
});

/* KOS-V1-BUG-006's two CTAs, now that the card sits over the locked dashboard:
   starting walks into onboarding, deferring simply leaves the preview. */
describe("WelcomeCard routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn(ok));
  });

  it("walks a starting user into onboarding", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/create" />);

    await user.click(screen.getByRole("button", { name: "Set Up Your Brand" }));

    expect(push).toHaveBeenCalledWith("/brand/create");
  });

  /* Deferring leaves them on the dashboard they are already looking at —
     navigating anywhere would undo the point of "Maybe later". */
  it("leaves a deferring user where they are", async () => {
    const user = userEvent.setup();
    render(<WelcomeCard onboardingHref="/brand/onboarding" />);

    await user.click(screen.getByRole("button", { name: "Maybe later" }));

    expect(push).not.toHaveBeenCalled();
  });
});
