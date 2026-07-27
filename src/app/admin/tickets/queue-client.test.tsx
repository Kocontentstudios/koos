import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { QueueRow } from "./queue-client";
import { QueueClient } from "./queue-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

function row(overrides: Partial<QueueRow>): QueueRow {
  return {
    id: overrides.id ?? "id-1",
    ticketNumber: 1,
    designType: "Instagram Post",
    dimensions: null,
    slides: null,
    brief: "A brief",
    status: "submitted",
    priority: "normal",
    brandName: "Acme",
    campaignName: null,
    itemTitle: null,
    dueDate: null,
    ...overrides,
  };
}

const QUEUE: QueueRow[] = [
  row({ id: "submitted-1", ticketNumber: 101, status: "submitted" }),
  row({ id: "progress-1", ticketNumber: 102, status: "in_progress" }),
  row({ id: "revision-1", ticketNumber: 103, status: "revision_requested" }),
  row({ id: "revision-2", ticketNumber: 104, status: "revision_requested" }),
];

describe("QueueClient status tabs", () => {
  it("shows every row under the All tab", () => {
    render(<QueueClient queue={QUEUE} />);
    expect(screen.getByText(formatTicketNumber(101))).toBeInTheDocument();
    expect(screen.getByText(formatTicketNumber(102))).toBeInTheDocument();
    expect(screen.getByText(formatTicketNumber(103))).toBeInTheDocument();
    expect(screen.getByText(formatTicketNumber(104))).toBeInTheDocument();
  });

  it("shows a count badge on the Needs revision tab matching revision_requested rows", () => {
    render(<QueueClient queue={QUEUE} />);
    const tab = screen.getByRole("button", { name: /needs revision/i });
    expect(tab).toHaveTextContent("2");
  });

  it("filters to only revision_requested rows when Needs revision is selected", async () => {
    render(<QueueClient queue={QUEUE} />);
    await userEvent.click(
      screen.getByRole("button", { name: /needs revision/i }),
    );
    expect(screen.queryByText(formatTicketNumber(101))).not.toBeInTheDocument();
    expect(screen.queryByText(formatTicketNumber(102))).not.toBeInTheDocument();
    expect(screen.getByText(formatTicketNumber(103))).toBeInTheDocument();
    expect(screen.getByText(formatTicketNumber(104))).toBeInTheDocument();
  });

  it("returns to the full list when All is reselected", async () => {
    render(<QueueClient queue={QUEUE} />);
    await userEvent.click(
      screen.getByRole("button", { name: /needs revision/i }),
    );
    await userEvent.click(screen.getByRole("button", { name: /^all/i }));
    expect(screen.getByText(formatTicketNumber(101))).toBeInTheDocument();
    expect(screen.getByText(formatTicketNumber(103))).toBeInTheDocument();
  });
});
