import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsClient } from "./settings-client";

vi.mock("./actions", () => ({
  changePasswordAction: vi.fn(),
  updateProfileAction: vi.fn(),
}));

const USER = {
  firstName: "Ada",
  lastName: "Lovelace",
  email: "ada@example.com",
  hasPassword: true,
};

describe("SettingsClient", () => {
  /* The tour never auto-appears again once resolved, so this link is the only
     way back to it. ?tour=1 is what the dashboard gate reads as a replay. */
  it("offers a replay of the product tour", () => {
    render(<SettingsClient user={USER} />);
    expect(screen.getByRole("link", { name: "Replay Tour" })).toHaveAttribute(
      "href",
      "/dashboard?tour=1",
    );
  });
});
