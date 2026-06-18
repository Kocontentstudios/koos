import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
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
