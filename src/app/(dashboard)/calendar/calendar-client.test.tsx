import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import { CalendarClient } from "./calendar-client";
import type { BrandSummary, SerializedCalendar, SerializedItem } from "./types";

/* The drawers import server actions, which reach the db client at module load;
   the house pattern is to stub the action module the same way the sibling
   drawer tests do. */
vi.mock("./actions", () => ({
  updateCalendarItemAction: vi.fn(),
  deleteCalendarItemAction: vi.fn(),
  updateCalendarItemStatusAction: vi.fn(),
  createCalendarItemAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/calendar",
  useSearchParams: () => new URLSearchParams(),
}));

/* Canvas-backed and network-backed children are irrelevant to the banner wire
   and would drag jsdom into unrelated failures. */
vi.mock("@/components/design/generate-design-button", () => ({
  GenerateDesignButton: () => null,
}));

const calendar: SerializedCalendar = {
  id: "cal-1",
  startDate: "2026-08-01T00:00:00.000Z",
  endDate: "2026-08-31T00:00:00.000Z",
};

const brand: BrandSummary = {
  id: "brand-1",
  name: "QA Brand",
  primaryColor: null,
  secondaryColor: null,
  logoUrl: null,
};

const items: SerializedItem[] = [
  {
    id: "item-1",
    date: "2026-08-10T00:00:00.000Z",
    time: null,
    platform: "Instagram",
    contentType: "Post",
    title: "Launch flyer",
    brief: null,
    caption: null,
    notes: null,
    designRequired: true,
    designType: "Flyer",
    dimensions: null,
    status: "draft",
    source: "ai",
  },
];

function renderCalendar(
  pickMode: boolean,
  {
    searchParams = "",
    withItems = true,
    submittedItemIds = [] as string[],
  } = {},
) {
  return render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <CalendarClient
        calendar={calendar}
        items={withItems ? items : []}
        brand={brand}
        campaignName="QA Campaign"
        submittedItemIds={submittedItemIds}
        calendarOptions={[]}
        pickMode={pickMode}
      />
    </NuqsTestingAdapter>,
  );
}

const BANNER = /Pick a content item to request a design for/;

describe("CalendarClient pick mode", () => {
  /* This is the seam the ?pick=design link depends on. Without it, retyping the
     param check or dropping the prop leaves every other test green. */
  it("guides the user when they arrived from the design chooser", () => {
    // agenda is the view the chooser links to, and the only one whose items
    // open the drawer directly.
    renderCalendar(true, { searchParams: "view=agenda&date=2026-08-01" });
    expect(screen.getByText(BANNER)).toBeInTheDocument();
  });

  it("stays out of the way on an ordinary calendar visit", () => {
    renderCalendar(false, { searchParams: "view=agenda&date=2026-08-01" });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
  });

  /* Agenda lists only items from the focused date onward. Zero items is the
     one case where that date filter cannot matter, so this uses real items
     dated before the focused day. */
  it("offers an escape when every item falls before the focused date", () => {
    renderCalendar(true, { searchParams: "view=agenda&date=2026-08-20" });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Nothing here to request a design for/),
    ).toBeInTheDocument();
  });

  /* Month is the default view, so this is what a user sees if they switch back
     to it while still in pick mode. */
  it("asks month users to open a day rather than click an unclickable chip", () => {
    renderCalendar(true, { searchParams: "view=month" });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Open a day to pick one of its posts/),
    ).toBeInTheDocument();
  });

  /* Every visible item already has a ticket, so each drawer shows a disabled
     "Design Ticket Submitted" — there is nothing left to pick. This pins the
     submittedItemIds → guidance wire, not just the guidance function. */
  it("offers an escape when every visible item already has a ticket", () => {
    renderCalendar(true, {
      searchParams: "view=agenda&date=2026-08-01",
      submittedItemIds: ["item-1"],
    });
    expect(screen.queryByText(BANNER)).not.toBeInTheDocument();
    expect(
      screen.getByText(/Nothing here to request a design for/),
    ).toBeInTheDocument();
  });
});
