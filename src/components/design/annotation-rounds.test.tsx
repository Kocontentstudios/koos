import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/design/annotation-overlay", () => ({
  AnnotationOverlay: ({ imageUrl }: { imageUrl: string }) => (
    <div data-testid="overlay" data-url={imageUrl} />
  ),
}));

import { AnnotationRounds } from "./annotation-rounds";

const shape = { type: "rect" as const, coords: [0, 0, 1, 1], color: "#f00" };

const deliverable = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "d1",
  fileName: "flyer.png",
  version: 1,
  createdAt: new Date("2026-08-01"),
  ...over,
});

describe("AnnotationRounds", () => {
  it("renders nothing when no deliverable carries a mark", () => {
    const { container } = render(
      <AnnotationRounds
        ticketId="t-1"
        deliverables={[deliverable()]}
        annotations={[]}
        currentVersion={1}
        title="Your markup"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the marked file, its notes and the caller's title", () => {
    render(
      <AnnotationRounds
        ticketId="t-1"
        deliverables={[deliverable()]}
        annotations={[
          { deliverableId: "d1", shapes: [shape], note: "Logo too small" },
        ]}
        currentVersion={1}
        title="Your markup"
      />,
    );

    expect(screen.getByText("Your markup")).toBeInTheDocument();
    expect(screen.getByText("flyer.png")).toBeInTheDocument();
    expect(screen.getByText("Logo too small")).toBeInTheDocument();
    expect(screen.getByTestId("overlay")).toHaveAttribute(
      "data-url",
      "/api/design-tickets/t-1/deliverables/d1?disposition=inline",
    );
  });

  it("skips deliverables that were never marked", () => {
    render(
      <AnnotationRounds
        ticketId="t-1"
        deliverables={[
          deliverable(),
          deliverable({ id: "d2", fileName: "b.png" }),
        ]}
        annotations={[{ deliverableId: "d1", shapes: [shape], note: null }]}
        currentVersion={1}
        title="Your markup"
      />,
    );
    expect(screen.getByText("flyer.png")).toBeInTheDocument();
    expect(screen.queryByText("b.png")).not.toBeInTheDocument();
  });

  /* An older round's feedback has already been acted on, so it must not sit
     next to the live round looking equally outstanding. */
  it("collapses a superseded round and says where it was addressed", () => {
    render(
      <AnnotationRounds
        ticketId="t-1"
        deliverables={[
          deliverable(),
          deliverable({ id: "d2", fileName: "v2.png", version: 2 }),
        ]}
        annotations={[
          { deliverableId: "d1", shapes: [shape], note: "Round 1 note" },
          { deliverableId: "d2", shapes: [shape], note: "Round 2 note" },
        ]}
        currentVersion={2}
        title="Your markup"
      />,
    );

    const rounds = screen.getAllByRole("group");
    // Newest round first, and only it is open.
    expect(rounds[0]).toHaveAttribute("open");
    expect(rounds[1]).not.toHaveAttribute("open");
    expect(screen.getByText(/addressed in v2/)).toBeInTheDocument();
  });

  it("merges several marks on one file into a single overlay", () => {
    render(
      <AnnotationRounds
        ticketId="t-1"
        deliverables={[deliverable()]}
        annotations={[
          { deliverableId: "d1", shapes: [shape], note: "First" },
          { deliverableId: "d1", shapes: [shape], note: "Second" },
        ]}
        currentVersion={1}
        title="Reviewer annotations"
      />,
    );

    expect(screen.getAllByTestId("overlay")).toHaveLength(1);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("drops empty notes rather than rendering blank bullets", () => {
    render(
      <AnnotationRounds
        ticketId="t-1"
        deliverables={[deliverable()]}
        annotations={[
          { deliverableId: "d1", shapes: [shape], note: "   " },
          { deliverableId: "d1", shapes: [shape], note: null },
        ]}
        currentVersion={1}
        title="Your markup"
      />,
    );
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
