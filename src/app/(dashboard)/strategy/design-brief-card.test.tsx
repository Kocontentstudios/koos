import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  DesignBriefCard,
  type PersistedDesignBrief,
} from "./design-brief-card";

const brief: PersistedDesignBrief = {
  id: "brief-1",
  title: "Summer Sale Carousel",
  designType: "Instagram Carousel (1080x1350 per slide)",
  dimensions: "1080x1350",
  slides: 5,
  briefMarkdown: "**Title**\nSummer Sale",
  notes: null,
  ticketId: null,
  createdAt: "2026-07-21T10:00:00.000Z",
};

describe("DesignBriefCard", () => {
  it("shows the brief's title and format metadata", () => {
    render(<DesignBriefCard brief={brief} onOpen={() => {}} />);
    expect(screen.getByText("Summer Sale Carousel")).toBeInTheDocument();
    expect(
      screen.getByText(/Instagram Carousel .*1080x1350.*5 slides/),
    ).toBeInTheDocument();
  });

  it("opens the brief when clicked", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DesignBriefCard brief={brief} onOpen={onOpen} />);
    await user.click(
      screen.getByRole("button", { name: /open design brief/i }),
    );
    expect(onOpen).toHaveBeenCalledWith("brief-1");
  });

  it("marks a brief that was submitted as a ticket", () => {
    render(
      <DesignBriefCard
        brief={{ ...brief, ticketId: "t-1" }}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/sent to design team/i)).toBeInTheDocument();
  });

  it("does not show the sent badge for an unsubmitted brief", () => {
    render(<DesignBriefCard brief={brief} onOpen={() => {}} />);
    expect(screen.queryByText(/sent to design team/i)).not.toBeInTheDocument();
  });
});
