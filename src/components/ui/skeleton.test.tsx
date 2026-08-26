import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Skeleton } from "./skeleton";

describe("Skeleton", () => {
  /* Regression: this used bg-muted, and --muted resolves to --surface-1, which
     is #ffffff in light mode — the same colour as the card it sits inside. A
     loading dashboard rendered as a blank page. */
  it("paints with the dedicated skeleton token, not a surface colour", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("bg-skeleton");
    expect(el.className).not.toContain("bg-muted");
    expect(el.className).not.toContain("bg-surface-1");
    expect(el.className).not.toContain("bg-surface-2");
  });

  it("animates so it reads as pending rather than as content", () => {
    const { container } = render(<Skeleton />);
    expect((container.firstElementChild as HTMLElement).className).toContain(
      "animate-pulse",
    );
  });

  /* The container owns the announcement, so a page of placeholders reads as
     one "Loading X" instead of a burst of nameless nodes. */
  it("stays out of the accessibility tree", () => {
    render(
      <div role="status" aria-label="Loading things">
        <Skeleton />
      </div>,
    );
    const status = screen.getByRole("status", { name: "Loading things" });
    expect(status.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("merges caller classes without dropping its own", () => {
    const { container } = render(<Skeleton className="h-10 w-full" />);
    const cls = (container.firstElementChild as HTMLElement).className;
    expect(cls).toContain("h-10");
    expect(cls).toContain("bg-skeleton");
  });
});
