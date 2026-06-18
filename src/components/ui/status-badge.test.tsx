import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "./status-badge";

describe("StatusBadge", () => {
  it("renders the label text", () => {
    render(<StatusBadge status="ready">Ready</StatusBadge>);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
  it("applies a status-specific class for pending", () => {
    render(<StatusBadge status="pending">Pending</StatusBadge>);
    expect(screen.getByText("Pending").className).toMatch(/status-pending/);
  });
});
