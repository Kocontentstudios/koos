import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTicketNumber } from "@/lib/design/ticket";
import type { Assignee, QueueRow } from "./queue-client";
import { QueueClient } from "./queue-client";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

/* Captures the setter so the search behaviour is actually exercised. Stubbing
   it to a no-op made the whole search block assert only that an <input> has a
   label — the trim, the page reset and the pending region were untested. */
const setQuery = vi.fn();
let queryState = { q: "", page: 1 };

vi.mock("nuqs", () => ({
  useQueryStates: () => [queryState, setQuery],
}));

afterEach(() => {
  vi.unstubAllGlobals();
  setQuery.mockClear();
  queryState = { q: "", page: 1 };
});

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
    designerId: null,
    assigneeName: "",
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
  { key: "open", label: "Open", href: "/admin/tickets", active: true },
  {
    key: "needs_revision",
    label: "Needs revision",
    href: "/admin/tickets?view=needs_revision",
    active: false,
    count: 2,
  },
];

const STAFF: Assignee[] = [
  { id: "d1", name: "Tolu A", role: "designer" },
  { id: "d2", name: "Bimpe O", role: "designer" },
];

function renderQueue(props: Partial<Parameters<typeof QueueClient>[0]> = {}) {
  return render(
    <QueueClient
      queue={QUEUE}
      filters={FILTERS}
      page={1}
      pages={1}
      prevHref={null}
      nextHref={null}
      workload={null}
      assignees={[]}
      canAssign={false}
      {...props}
    />,
  );
}

/* Filtering moved to the URL: a dashboard drill-down is a link, and it has to
   land on a filtered list rather than a full one the browser then trims. The
   predicate behind each view is tested without a database in scope.test.ts;
   what belongs here is that the container renders what it is handed. */
describe("QueueClient", () => {
  it("renders every row it is given", () => {
    renderQueue();
    for (const n of [101, 102, 103, 104]) {
      expect(screen.getByText(formatTicketNumber(n))).toBeInTheDocument();
    }
  });

  it("offers each view as a link, not a local toggle", () => {
    renderQueue();
    expect(
      screen.getByRole("link", { name: /needs revision/i }),
    ).toHaveAttribute("href", "/admin/tickets?view=needs_revision");
  });

  it("marks the active view for assistive tech, not just colour", () => {
    renderQueue();
    expect(screen.getByRole("link", { name: /open/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  /* The count comes from the server, so it reflects every match — not the
     page of rows that happens to be loaded. */
  it("reports a total larger than the rows on screen", () => {
    renderQueue({ total: 137 });
    expect(screen.getByText(/137 tickets/)).toBeInTheDocument();
  });

  it("says something useful when a view is empty", () => {
    renderQueue({ queue: [], emptyMessage: "Nothing is overdue." });
    expect(screen.getByText("Nothing is overdue.")).toBeInTheDocument();
  });
});

/* Every one of these was dropped when the queue moved to a URL-driven scope:
   the page kept rendering, so nothing failed, and the row simply carried less
   information than it had the day before. */
describe("the row keeps the context a designer works from", () => {
  it("shows the brief preview", () => {
    renderQueue({
      queue: [row({ id: "b", brief: "Launch teaser, 3 panels" })],
    });
    expect(screen.getByText("Launch teaser, 3 panels")).toBeInTheDocument();
  });

  it("shows the deliverable spec, not just the type", () => {
    renderQueue({
      queue: [
        row({
          id: "c",
          designType: "Carousel",
          dimensions: "1080×1350",
          slides: 8,
        }),
      ],
    });
    expect(
      screen.getByText("Carousel · 1080×1350 · 8 slides"),
    ).toBeInTheDocument();
  });

  it("shows the campaign and calendar item behind the ticket", () => {
    renderQueue({
      queue: [
        row({
          id: "d",
          brandName: "Acme",
          campaignName: "Q4 Launch",
          itemTitle: "Teaser 1",
        }),
      ],
    });
    expect(screen.getByText("Acme · Q4 Launch · Teaser 1")).toBeInTheDocument();
  });
});

describe("overdue rows", () => {
  it("says how long overdue, not just the due date", () => {
    renderQueue({ queue: [row({ id: "late", overdueFor: "3 days" })] });
    expect(screen.getByText(/3 days overdue/)).toBeInTheDocument();
  });

  it("names the assignee, or says nobody has it", () => {
    renderQueue({ queue: [row({ id: "u", assigneeName: "" })] });
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });
});

describe("assign and reassign", () => {
  it("offers the roster to someone who can complete the change", () => {
    renderQueue({
      queue: [row({ id: "a", designerId: "d1", assigneeName: "Tolu A" })],
      assignees: STAFF,
      canAssign: true,
    });
    const select = screen.getByRole("combobox", { name: /assign/i });
    expect(select).toHaveValue("d1");
    expect(screen.getByRole("option", { name: "Bimpe O" })).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Unassigned" }),
    ).toBeInTheDocument();
  });

  /* /manage refuses reassignment for a designer, so offering the control to
     one is an action that can only fail. */
  it("is hidden from a designer, who cannot complete it", () => {
    renderQueue({
      queue: [row({ id: "a", designerId: "d1" })],
      assignees: [],
      canAssign: false,
    });
    expect(
      screen.queryByRole("combobox", { name: /assign/i }),
    ).not.toBeInTheDocument();
  });

  it("posts the chosen designer to the manage route", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderQueue({
      queue: [row({ id: "tk-9", designerId: null })],
      assignees: STAFF,
      canAssign: true,
    });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /assign/i }),
      "d2",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tickets/tk-9/manage",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ assignedDesignerId: "d2" }),
      }),
    );
  });

  /* Unassigning is a real intent, and the route reads null — not "" — as it. */
  it("sends null when the ticket is unassigned", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderQueue({
      queue: [row({ id: "tk-9", designerId: "d1" })],
      assignees: STAFF,
      canAssign: true,
    });

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /assign/i }),
      "",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/tickets/tk-9/manage",
      expect.objectContaining({
        body: JSON.stringify({ assignedDesignerId: null }),
      }),
    );
  });
});

describe("send reminder", () => {
  it("is offered only when someone is carrying the ticket", () => {
    const { unmount } = renderQueue({
      queue: [row({ id: "a", designerId: "d1", assigneeName: "Tolu A" })],
    });
    expect(
      screen.getByRole("button", { name: /send reminder/i }),
    ).toBeInTheDocument();
    unmount();

    renderQueue({ queue: [row({ id: "b", designerId: null })] });
    expect(
      screen.queryByRole("button", { name: /send reminder/i }),
    ).not.toBeInTheDocument();
  });

  /* A designer whose first and last name are both null renders as "", so
     gating on the display name silently removed the action from a genuinely
     assigned ticket. */
  it("is offered to a designer with no name on record", () => {
    renderQueue({
      queue: [row({ id: "a", designerId: "d1", assigneeName: "" })],
    });
    expect(
      screen.getByRole("button", { name: /send reminder/i }),
    ).toBeInTheDocument();
  });

  /* Work in review is waiting on the CLIENT. Nudging the designer there tells
     the operator the wrong person is late. */
  it("is not offered while the ticket sits with the client", () => {
    renderQueue({
      queue: [row({ id: "a", designerId: "d1", status: "ready_for_review" })],
    });
    expect(
      screen.queryByRole("button", { name: /send reminder/i }),
    ).not.toBeInTheDocument();
  });

  /* The rule most easily broken on a list: one shared boolean makes every row
     claim to be working when one of them is. */
  it("shows pending on the row that was clicked, not the others", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            release = r;
          }),
      ),
    );
    renderQueue({
      queue: [
        row({ id: "a", ticketNumber: 201, designerId: "d1" }),
        row({ id: "b", ticketNumber: 202, designerId: "d2" }),
      ],
    });

    const [first, second] = screen.getAllByRole("button", {
      name: /send reminder|sending/i,
    });
    await userEvent.click(first);

    expect(first).toHaveAttribute("data-loading", "true");
    expect(second).not.toHaveAttribute("data-loading", "true");

    release(new Response("{}", { status: 200 }));
  });
});

describe("the assign control while a write is in flight", () => {
  /* Two writes to one ticket from one row is a lost update. The select has to
     go disabled with everything else. */
  it("disables the select while the row is acting", async () => {
    let release: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((r) => {
            release = r;
          }),
      ),
    );
    renderQueue({
      queue: [row({ id: "a", designerId: "d1" })],
      assignees: STAFF,
      canAssign: true,
    });

    await userEvent.click(
      screen.getByRole("button", { name: /send reminder/i }),
    );
    expect(screen.getByRole("combobox", { name: /assign/i })).toBeDisabled();

    release(new Response("{}", { status: 200 }));
  });

  it("leaves it enabled when nothing is in flight", () => {
    renderQueue({
      queue: [row({ id: "a", designerId: "d1" })],
      assignees: STAFF,
      canAssign: true,
    });
    expect(screen.getByRole("combobox", { name: /assign/i })).toBeEnabled();
  });
});

describe("pagination", () => {
  /* Without a pager the overdue drill-down truncated at one page and the rows
     past it were reachable only by hand-editing the URL. */
  it("offers a way forward when there is more than one page", () => {
    renderQueue({
      total: 137,
      page: 2,
      pages: 3,
      prevHref: "/admin/tickets?page=1",
      nextHref: "/admin/tickets?page=3",
    });
    expect(screen.getByText("Page 2 of 3")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /previous/i })).toHaveAttribute(
      "href",
      "/admin/tickets?page=1",
    );
    expect(screen.getByRole("link", { name: /next/i })).toHaveAttribute(
      "href",
      "/admin/tickets?page=3",
    );
  });

  it("does not render a pager for a single page", () => {
    renderQueue({ total: 4, page: 1, pages: 1 });
    expect(
      screen.queryByRole("navigation", { name: /pagination/i }),
    ).not.toBeInTheDocument();
  });

  /* Past the end there is no Next and no rows, so hiding the pager leaves the
     URL bar as the only way back into the list. */
  it("still renders the pager past the last page", () => {
    renderQueue({
      queue: [],
      total: 137,
      page: 99,
      pages: 3,
      prevHref: "/admin/tickets?page=3",
      nextHref: null,
    });
    expect(
      screen.getByRole("navigation", { name: /pagination/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /previous/i }).getAttribute("href"),
    ).toContain("page=3");
  });

  it("disables the edge rather than linking nowhere", () => {
    renderQueue({
      total: 137,
      page: 1,
      pages: 3,
      prevHref: null,
      nextHref: "/admin/tickets?page=2",
    });
    expect(screen.queryByRole("link", { name: /previous/i })).toBeNull();
    expect(screen.getByText(/previous/i)).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("the designer drill-down says whose list it is", () => {
  /* "assigned tickets AND workload". Without the header the page is a filtered
     table that never names the person it is filtered to. */
  it("names the designer and what they are carrying", () => {
    renderQueue({
      workload: { name: "Tolu A", active: 7, overdue: 2 },
    });
    expect(screen.getByText("Tolu A")).toBeInTheDocument();
    expect(screen.getByText("7 active")).toBeInTheDocument();
    expect(screen.getByText("2 overdue")).toBeInTheDocument();
  });

  it("says nothing about overdue work when there is none", () => {
    renderQueue({ workload: { name: "Tolu A", active: 7, overdue: 0 } });
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });
});

/* Server-side by construction: a paginated list filtered in the browser
   searches the visible page and looks like it worked. */
describe("search", () => {
  it("offers a labelled search input", () => {
    renderQueue();
    expect(
      screen.getByRole("searchbox", { name: /search tickets/i }),
    ).toBeInTheDocument();
  });

  it("submits the term to the URL, not to local filtering", async () => {
    renderQueue();
    await userEvent.type(
      screen.getByRole("searchbox", { name: /search tickets/i }),
      "logo",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(setQuery).toHaveBeenCalledWith({ q: "logo", page: null });
  });

  /* The old offset is meaningless against a new result set: without the reset,
     searching from page 3 lands on page 3 of two pages of results. */
  it("returns to the first page on a new search", async () => {
    queryState = { q: "", page: 3 };
    renderQueue({ page: 3, pages: 4 });
    await userEvent.type(
      screen.getByRole("searchbox", { name: /search tickets/i }),
      "logo",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(setQuery.mock.calls[0]?.[0]).toMatchObject({ page: null });
  });

  it("treats a whitespace-only term as no search", async () => {
    renderQueue();
    await userEvent.type(
      screen.getByRole("searchbox", { name: /search tickets/i }),
      "   ",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(setQuery).toHaveBeenCalledWith({ q: null, page: null });
  });

  it("offers a way out of an active search", async () => {
    queryState = { q: "logo", page: 1 };
    renderQueue();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(setQuery).toHaveBeenCalledWith({ q: null, page: null });
  });

  /* The affordance for a server round-trip. A region mounted at the same
     moment as its text is the case assistive tech misses. */
  it("keeps the live region mounted before there is anything to announce", () => {
    renderQueue();
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("");
    // aria-busy on a live region tells AT to withhold the update it exists for.
    expect(region).not.toHaveAttribute("aria-busy");
  });

  it("offers no Clear button when nothing is searched", () => {
    renderQueue();
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });

  /* Back/Forward changes the URL without touching local state, so the box kept
     showing a term the results no longer carried. */
  it("follows the URL when the query changes underneath it", () => {
    queryState = { q: "logo", page: 1 };
    const { rerender } = renderQueue();
    expect(screen.getByRole("searchbox")).toHaveValue("logo");

    queryState = { q: "", page: 1 };
    rerender(
      <QueueClient
        queue={QUEUE}
        filters={FILTERS}
        page={1}
        pages={1}
        prevHref={null}
        nextHref={null}
        workload={null}
        assignees={[]}
        canAssign={false}
      />,
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});
