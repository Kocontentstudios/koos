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

/* Every number on the dashboard should open the records behind it. The card
   stays a plain div without an href so the existing usages are untouched. */
/* CLAUDE.md: every bug fix ships the test that would have caught it. The ring
   was --border-accent, measured 1.79:1 dark and 1.65:1 light against WCAG
   1.4.11's 3:1; --border-control is 3.52:1 / 3.26:1 and globals.css says so on
   the token itself. Because `outline` is set explicitly the UA default is
   suppressed, so this ring IS the only focus indicator on the card. */
describe("focus indicator", () => {
  const ringClasses = () => {
    render(<StatCard label="Overdue" value={6} href="/admin/tickets" />);
    return screen.getByRole("link").className;
  };

  /* The token and the offset are ONE decision, asserted together. The offset
     moves the ring off the card onto --background, so a token measured against
     the card is measured against the wrong ground — that is how a ring tuned
     to 3.26:1 shipped at 2.88:1. Changing either half requires re-measuring. */
  it("draws the ring in a colour that clears 3:1 on the ground it lands on", () => {
    const cls = ringClasses();
    expect(cls).toContain("focus-visible:outline-[var(--primary)]");
    expect(cls).toContain("focus-visible:outline-offset-2");
  });

  it.each([
    ["--border-accent", "~1.7:1 on both grounds"],
    ["--border-control", "2.88:1 on --background in light mode"],
    ["--border", "a surface edge, far below 3:1"],
  ])("does not use %s (%s)", (token) => {
    expect(ringClasses()).not.toContain(`outline-[var(${token})]`);
  });

  it("draws no focus ring on a card that is not a link", () => {
    render(<StatCard label="Overdue" value={6} />);
    expect(screen.getByText("Overdue").parentElement?.className).not.toContain(
      "focus-visible:outline",
    );
  });
});

describe("drill-down", () => {
  it("becomes a link when given an href", () => {
    render(
      <StatCard label="Overdue" value={7} href="/admin/tickets?view=overdue" />,
    );
    const link = screen.getByRole("link", { name: /Overdue/ });
    expect(link).toHaveAttribute("href", "/admin/tickets?view=overdue");
  });

  it("stays a plain card without one", () => {
    render(<StatCard label="Overdue" value={7} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the value readable in the link's accessible name", () => {
    render(<StatCard label="Open tickets" value={42} href="/admin/tickets" />);
    expect(screen.getByRole("link", { name: /42/ })).toBeInTheDocument();
  });
});
