import { render, screen } from "@testing-library/react";
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
    title: null,
    assigneeName: null,
    overdueFor: null,
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

const FILTERS = [
  {
    key: "open",
    label: "Open",
    href: "/admin/tickets?view=open",
    active: true,
  },
  {
    key: "needs_revision",
    label: "Needs revision",
    href: "/admin/tickets?view=needs_revision",
    active: false,
    count: 2,
  },
];

/* Filtering moved to the URL: a dashboard drill-down is a link, and it has to
   land on a filtered list rather than a full one the browser then trims. The
   predicate behind each view is tested without a database in scope.test.ts;
   what belongs here is that the container renders what it is handed. */
describe("QueueClient", () => {
  it("renders every row it is given", () => {
    render(<QueueClient queue={QUEUE} filters={FILTERS} />);
    for (const n of [101, 102, 103, 104]) {
      expect(screen.getByText(formatTicketNumber(n))).toBeInTheDocument();
    }
  });

  it("offers each view as a link, not a local toggle", () => {
    render(<QueueClient queue={QUEUE} filters={FILTERS} />);
    expect(
      screen.getByRole("link", { name: /needs revision/i }),
    ).toHaveAttribute("href", "/admin/tickets?view=needs_revision");
  });

  it("marks the active view for assistive tech, not just colour", () => {
    render(<QueueClient queue={QUEUE} filters={FILTERS} />);
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("shows the count a view carries", () => {
    render(<QueueClient queue={QUEUE} filters={FILTERS} />);
    expect(
      screen.getByRole("link", { name: /needs revision/i }),
    ).toHaveTextContent("2");
  });

  /* The count comes from the server, so it reflects every match — not the
     page of rows that happens to be loaded. */
  it("reports a total larger than the rows on screen", () => {
    render(<QueueClient queue={QUEUE} filters={FILTERS} total={137} />);
    expect(screen.getByText(/137 tickets/)).toBeInTheDocument();
  });

  it("says something useful when a view is empty", () => {
    render(
      <QueueClient
        queue={[]}
        filters={FILTERS}
        emptyMessage="Nothing is overdue."
      />,
    );
    expect(screen.getByText("Nothing is overdue.")).toBeInTheDocument();
  });
});

describe("overdue rows", () => {
  it("says how long overdue, not just the due date", () => {
    render(
      <QueueClient
        queue={[row({ id: "late", overdueFor: "3 days" })]}
        filters={FILTERS}
      />,
    );
    expect(screen.getByText(/3 days overdue/)).toBeInTheDocument();
  });

  it("names the assignee, or says nobody has it", () => {
    render(
      <QueueClient
        queue={[row({ id: "u", assigneeName: "" })]}
        filters={FILTERS}
      />,
    );
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});
