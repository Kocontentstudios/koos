import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeliveredRow } from "./delivered-client";
import { DeliveredClient } from "./delivered-client";

const setQuery = vi.fn();
let queryState = { q: "", page: 1 };

vi.mock("nuqs", () => ({
  useQueryStates: () => [queryState, setQuery],
}));

/* The pending flag is internal to the component and a real transition settles
   before an assertion can see it. */
let pendingOverride = false;
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useTransition: () => {
      const [, start] = actual.useTransition();
      return [pendingOverride, start] as const;
    },
  };
});

beforeEach(() => {
  setQuery.mockClear();
  queryState = { q: "", page: 1 };
  pendingOverride = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const ROW: DeliveredRow = {
  id: "t1",
  ticketNumber: 73,
  title: "Signed off",
  brandName: "Acme Co",
  requesterName: "Cara Client",
  designerName: "Bimpe Okafor",
  deliveredOn: "Aug 24, 2026",
  approvedOn: "Sep 1, 2026",
  status: "delivered",
};

function renderTable(
  props: Partial<Parameters<typeof DeliveredClient>[0]> = {},
) {
  return render(
    <DeliveredClient
      rows={[ROW]}
      filters={[
        {
          key: "delivered",
          label: "All delivered",
          href: "/admin/delivered",
          active: true,
        },
      ]}
      ranges={[
        {
          key: "all",
          label: "Any time",
          href: "/admin/delivered",
          active: true,
        },
      ]}
      total={1}
      page={1}
      pages={1}
      prevHref={null}
      nextHref={null}
      emptyMessage="Nothing has been delivered yet."
      {...props}
    />,
  );
}

describe("search", () => {
  /* Server-side by construction: filtering a paginated list in the browser
     searches the visible page and looks like it worked. */
  it("submits the term to the URL", async () => {
    renderTable();
    await userEvent.type(
      screen.getByRole("searchbox", { name: /search delivered/i }),
      "acme",
    );
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(setQuery).toHaveBeenCalledWith({ q: "acme", page: null });
  });

  /* Without the reset, searching from page 3 lands on page 3 of one page of
     results — the "past the end" state, reached by doing nothing wrong. */
  it("returns to the first page on a new search", async () => {
    queryState = { q: "", page: 3 };
    renderTable({ page: 3, pages: 4 });
    await userEvent.type(screen.getByRole("searchbox"), "acme");
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(setQuery.mock.calls[0]?.[0]).toMatchObject({ page: null });
  });

  it("treats a whitespace-only term as no search", async () => {
    renderTable();
    await userEvent.type(screen.getByRole("searchbox"), "   ");
    await userEvent.click(screen.getByRole("button", { name: /^search$/i }));
    expect(setQuery).toHaveBeenCalledWith({ q: null, page: null });
  });

  it("offers a way out of an active search", async () => {
    queryState = { q: "acme", page: 1 };
    renderTable();
    await userEvent.click(screen.getByRole("button", { name: /clear/i }));
    expect(setQuery).toHaveBeenCalledWith({ q: null, page: null });
  });

  /* Back/Forward changes the URL without touching local state. */
  it("follows the URL when the query changes underneath it", () => {
    queryState = { q: "acme", page: 1 };
    const { rerender } = renderTable();
    expect(screen.getByRole("searchbox")).toHaveValue("acme");

    queryState = { q: "", page: 1 };
    rerender(
      <DeliveredClient
        rows={[ROW]}
        filters={[]}
        ranges={[]}
        total={1}
        page={1}
        pages={1}
        prevHref={null}
        nextHref={null}
        emptyMessage="none"
      />,
    );
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
});

describe("the wait is announced", () => {
  /* shallow:false means every search is a server round-trip. CLAUDE.md: the
     container carries role="status" and real text. */
  it("keeps the live region mounted before there is anything to say", () => {
    renderTable();
    const region = screen.getByRole("status");
    expect(region).toBeInTheDocument();
    expect(region).toHaveTextContent("");
  });

  it("announces the wait once a search is in flight", () => {
    pendingOverride = true;
    renderTable();
    expect(screen.getByRole("status")).toHaveTextContent(/updating results/i);
  });

  /* aria-busy on a live region tells assistive tech to withhold the very
     update the region exists to deliver. */
  it("never marks the region busy", () => {
    pendingOverride = true;
    renderTable();
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy");
  });

  it("dims the stale rows while they are replaced", () => {
    pendingOverride = true;
    renderTable();
    expect(document.querySelector("table")?.parentElement?.className).toContain(
      "opacity-60",
    );
  });
});

describe("the table", () => {
  it("renders every required column for a row", () => {
    renderTable();
    const cells = Array.from(document.querySelectorAll("tbody td")).map(
      (c) => c.textContent,
    );
    expect(cells).toEqual([
      "DT-00073",
      "Signed off",
      "Acme Co",
      "Cara Client",
      "Bimpe Okafor",
      "Aug 24, 2026",
      "Sep 1, 2026",
      "Approved",
      "View DT-00073",
    ]);
  });

  /* Wide content scrolls in its own container so the page body never scrolls
     sideways. */
  it("scrolls itself rather than the page", () => {
    renderTable();
    expect(document.querySelector("table")?.parentElement?.className).toContain(
      "overflow-x-auto",
    );
  });

  it("says what is empty rather than rendering an empty table", () => {
    renderTable({ rows: [], emptyMessage: "Nothing has been delivered yet." });
    expect(document.querySelector("table")).toBeNull();
    expect(
      screen.getByText("Nothing has been delivered yet."),
    ).toBeInTheDocument();
  });
});
