import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";

vi.mock("../actions", () => ({ signup: vi.fn(), signInWithGoogle: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

describe("RegisterPage wordmark", () => {
  it("links the KO OS wordmark to the landing page", () => {
    render(<RegisterPage />);
    const link = screen.getByRole("link", { name: /KO OS — back to home/i });
    expect(link).toHaveAttribute("href", "/");
  });
});
