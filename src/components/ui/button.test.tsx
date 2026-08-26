import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

describe("Button", () => {
  it("renders its children", () => {
    render(<Button>Start Creating</Button>);
    expect(
      screen.getByRole("button", { name: "Start Creating" }),
    ).toBeInTheDocument();
  });
  it("applies the primary background by default", () => {
    render(<Button>Go</Button>);
    expect(screen.getByRole("button", { name: "Go" }).className).toMatch(
      /bg-primary/,
    );
  });
  it("renders a secondary (outline) variant with a border", () => {
    render(<Button variant="secondary">Cancel</Button>);
    const cls = screen.getByRole("button", { name: "Cancel" }).className;
    expect(cls).toMatch(/border/);
    expect(cls).not.toMatch(/bg-primary\b/);
  });
  it("renders a ghost variant with a transparent background", () => {
    render(<Button variant="ghost">More</Button>);
    expect(screen.getByRole("button", { name: "More" }).className).not.toMatch(
      /bg-primary\b/,
    );
  });
});

/**
 * `loading` is the app's pending-state contract — a dozen call-site tests
 * assert against the behaviour defined here, but the primitive itself had no
 * coverage, so the contract they depend on was unpinned.
 */
describe("Button loading state", () => {
  it("swaps the label for loadingText and shows a spinner", () => {
    const { container } = render(
      <Button loading loadingText="Saving…">
        Save
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
    expect(screen.queryByText("Save")).not.toBeInTheDocument();
    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("keeps the original label when no loadingText is given", () => {
    render(<Button loading>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
  });

  it("marks itself busy and disabled so the click cannot repeat", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <Button loading loadingText="Saving…" onClick={onClick}>
        Save
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("stays busy-free and enabled when idle", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  /* An explicitly disabled button must stay disabled regardless of loading. */
  it("respects an explicit disabled alongside loading", () => {
    render(<Button disabled>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });
});
