import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatCard } from "./stat-card";

describe("StatCard", () => {
  it("renders the label and value", () => {
    render(<StatCard label="Generations" value={142} />);
    expect(screen.getByText("Generations")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
  });

  /* The existing admin dashboard passes no change at all. It must not grow a
     stray delta from this refactor. */
  it("shows no delta when change is omitted", () => {
    const { container } = render(<StatCard label="Open tickets" value={4} />);
    expect(container.textContent).not.toContain("—");
    expect(container.textContent).not.toContain("%");
  });

  it("shows an upward delta", () => {
    render(<StatCard label="Generations" value={142} change={18} />);
    expect(screen.getByText("↑18%")).toBeInTheDocument();
  });

  it("shows a downward delta", () => {
    render(<StatCard label="Generations" value={80} change={-20} />);
    expect(screen.getByText("↓20%")).toBeInTheDocument();
  });

  /* null means the previous period was empty, which is different from 0%. */
  it("shows a dash when there is no comparable previous period", () => {
    render(<StatCard label="Generations" value={5} change={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("colours direction with theme tokens that adapt to light mode", () => {
    const { container: up } = render(
      <StatCard label="Up" value={1} change={18} />,
    );
    expect(up.querySelector('[style*="--status-ready-fg"]')).not.toBeNull();

    const { container: down } = render(
      <StatCard label="Down" value={1} change={-18} />,
    );
    expect(down.querySelector('[style*="--status-error-fg"]')).not.toBeNull();
  });

  it("treats a rounding-to-zero change as flat, not as a direction", () => {
    const { container } = render(
      <StatCard label="Flat" value={1} change={0.2} />,
    );
    expect(screen.getByText("0%")).toBeInTheDocument();
    expect(container.querySelector('[style*="--text-muted"]')).not.toBeNull();
  });

  it("renders the caption when given one", () => {
    render(<StatCard label="Generations" value={1} caption="last 7 days" />);
    expect(screen.getByText("last 7 days")).toBeInTheDocument();
  });
});
