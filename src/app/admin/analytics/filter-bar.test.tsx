import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setQuery = vi.fn();
let queryState = { range: "30d", from: "", to: "", page: 1 };

vi.mock("nuqs", () => ({
  useQueryStates: () => [queryState, setQuery],
}));

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

import { AnalyticsFilterBar, type FilterGroup } from "./filter-bar";

beforeEach(() => {
  setQuery.mockClear();
  queryState = { range: "30d", from: "", to: "", page: 1 };
  pendingOverride = false;
});

const GROUPS: FilterGroup[] = [
  {
    legend: "Date range",
    choices: [
      { key: "7d", label: "Last 7 days", href: "?range=7d", active: false },
      { key: "30d", label: "Last 30 days", href: "?range=30d", active: true },
    ],
  },
  {
    legend: "Activity type",
    choices: [
      {
        key: "design_generated",
        label: "Design image",
        href: "?kind=design_generated",
        active: false,
      },
    ],
  },
];

function renderBar(
  props: Partial<Parameters<typeof AnalyticsFilterBar>[0]> = {},
) {
  return render(
    <AnalyticsFilterBar
      groups={GROUPS}
      activeCount={0}
      clearHref="/admin/analytics?range=30d"
      {...props}
    />,
  );
}

/* FEAT-005 asks for a "visible Filter button". The panel stays closed by
   default so four groups do not push the numbers they filter below the fold. */
describe("the Filter button", () => {
  it("is visible and starts closed on an unfiltered view", () => {
    renderBar();
    const button = screen.getByRole("button", { name: /^filter$/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Last 7 days" })).toBeNull();
  });

  it("opens on click", async () => {
    renderBar();
    await userEvent.click(screen.getByRole("button", { name: /^filter$/i }));
    expect(
      screen.getByRole("link", { name: "Last 7 days" }),
    ).toBeInTheDocument();
  });

  /* Nobody should be looking at narrowed figures with no visible reason why. */
  it("starts open when a filter is already applied", () => {
    renderBar({ activeCount: 2 });
    expect(
      screen.getByRole("button", { name: /hide filters/i }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/2 filters applied/i)).toBeInTheDocument();
  });

  it("says nothing about filters on an unfiltered view", () => {
    renderBar();
    expect(screen.queryByText(/applied/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /clear all/i })).toBeNull();
  });

  it("offers a way to clear everything", () => {
    renderBar({ activeCount: 1 });
    expect(
      screen.getByRole("link", { name: /clear all/i }).getAttribute("href"),
    ).toBe("/admin/analytics?range=30d");
  });
});

/* Every option the ticket names must be reachable, and each is a Link carrying
   the whole scope so a filtered view is a shareable URL. */
describe("the filter groups", () => {
  it("renders every group it is given", () => {
    renderBar({ activeCount: 1 });
    for (const label of ["Last 7 days", "Last 30 days", "Design image"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("links each option rather than holding local state", () => {
    renderBar({ activeCount: 1 });
    expect(
      screen.getByRole("link", { name: "Last 7 days" }).getAttribute("href"),
    ).toBe("?range=7d");
  });

  it("marks the active option for assistive tech", () => {
    renderBar({ activeCount: 1 });
    expect(screen.getByRole("link", { name: "Last 30 days" })).toHaveAttribute(
      "aria-current",
    );
    expect(
      screen.getByRole("link", { name: "Last 7 days" }),
    ).not.toHaveAttribute("aria-current");
  });

  it("names each group for a screen reader", () => {
    renderBar({ activeCount: 1 });
    expect(screen.getAllByText("Date range").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Activity type").length).toBeGreaterThan(0);
  });
});

/* The ticket's fourth date option. Gutting the submit handler left the whole
   custom range dead while the form still rendered. */
describe("the custom date range", () => {
  const open = async () => {
    renderBar({ activeCount: 1 });
  };

  it("applies both bounds and sets range=custom in one navigation", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/^from$/i), "2026-01-01");
    await userEvent.type(screen.getByLabelText(/^to$/i), "2026-01-31");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));

    expect(setQuery).toHaveBeenCalledWith({
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
      page: null,
    });
  });

  /* A half-applied state — custom bounds with a preset still selected — must
     not be reachable, so the range moves in the same navigation. */
  it("never applies bounds without switching to custom", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/^from$/i), "2026-01-01");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(setQuery.mock.calls[0]?.[0]).toMatchObject({ range: "custom" });
  });

  it("returns to the first page", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/^from$/i), "2026-01-01");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(setQuery.mock.calls[0]?.[0]).toMatchObject({ page: null });
  });

  it("cannot be applied empty", async () => {
    await open();
    expect(screen.getByRole("button", { name: /apply/i })).toBeDisabled();
  });

  /* Back/Forward changes the URL without touching local state, so the inputs
     would keep showing a range the page is no longer displaying. */
  it("follows the URL when the bounds change underneath it", () => {
    queryState = {
      range: "custom",
      from: "2026-01-01",
      to: "2026-01-31",
      page: 1,
    };
    const { rerender } = renderBar({ activeCount: 1 });
    expect(screen.getByLabelText(/^from$/i)).toHaveValue("2026-01-01");

    queryState = { range: "30d", from: "", to: "", page: 1 };
    rerender(
      <AnalyticsFilterBar
        groups={GROUPS}
        activeCount={1}
        clearHref="/admin/analytics?range=30d"
      />,
    );
    expect(screen.getByLabelText(/^from$/i)).toHaveValue("");
  });
});

describe("the wait is announced", () => {
  it("keeps the live region mounted before there is anything to say", () => {
    renderBar({ activeCount: 1 });
    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("");
    expect(region).not.toHaveAttribute("aria-busy");
  });

  it("announces the wait while a custom range is applying", () => {
    pendingOverride = true;
    renderBar({ activeCount: 1 });
    expect(screen.getByRole("status")).toHaveTextContent(/updating analytics/i);
  });
});
