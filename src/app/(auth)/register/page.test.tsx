import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RegisterPage from "./page";

vi.mock("../actions", () => ({ signup: vi.fn(), signInWithGoogle: vi.fn() }));

// Mutable holder so individual tests can override the search params the
// mocked useSearchParams() returns without redefining the whole mock.
const mockSearchParams = { current: new URLSearchParams() };
vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams.current,
}));

afterEach(() => {
  mockSearchParams.current = new URLSearchParams();
});

describe("RegisterPage wordmark", () => {
  it("links the KO OS wordmark to the landing page", () => {
    render(<RegisterPage />);
    const link = screen.getByRole("link", { name: /KO OS — back to home/i });
    expect(link).toHaveAttribute("href", "/");
  });
});

describe("RegisterPage next param", () => {
  it("carries the invite next path and prefilled email into the form", () => {
    mockSearchParams.current = new URLSearchParams(
      "next=/invite/tok1&email=a@b.co",
    );
    render(<RegisterPage />);
    const nextInput = document.querySelector('input[name="next"]');
    expect(nextInput).toHaveValue("/invite/tok1");
    expect(screen.getByLabelText(/email/i)).toHaveValue("a@b.co");
  });
});
