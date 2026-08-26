import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireBrandMock,
  getCalendarsForBrandMock,
  getCalendarItemsMock,
  getStrategyByIdMock,
  getDesignTicketsForMemberMock,
  calendarClientProps,
} = vi.hoisted(() => ({
  requireBrandMock: vi.fn(),
  getCalendarsForBrandMock: vi.fn(),
  getCalendarItemsMock: vi.fn(),
  getStrategyByIdMock: vi.fn(),
  getDesignTicketsForMemberMock: vi.fn(),
  calendarClientProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/lib/auth/require-brand", () => ({ requireBrand: requireBrandMock }));
vi.mock("@/lib/db/queries", () => ({
  getCalendarsForBrand: getCalendarsForBrandMock,
  getCalendarItems: getCalendarItemsMock,
  getStrategyById: getStrategyByIdMock,
  getDesignTicketsForMember: getDesignTicketsForMemberMock,
}));

/* Capture the props instead of rendering the real client: this test is about
   the ?pick=design → pickMode wire, which nothing else covers. */
vi.mock("./calendar-client", () => ({
  CalendarClient: (props: Record<string, unknown>) => {
    calendarClientProps.current = props;
    return null;
  },
}));

import CalendarPage from "./page";

const calendarRow = {
  calendar: {
    id: "cal-1",
    strategyId: "strategy-1",
    brandId: "brand-1",
    startDate: new Date("2026-08-01T00:00:00.000Z"),
    endDate: new Date("2026-08-31T00:00:00.000Z"),
  },
  strategyName: "QA Campaign",
};

beforeEach(() => {
  vi.resetAllMocks();
  calendarClientProps.current = null;
  requireBrandMock.mockResolvedValue({
    dbUser: { id: "user-1" },
    workspace: { id: "ws-1" },
    role: "owner",
    brand: { id: "brand-1", name: "QA Brand" },
  });
  getCalendarsForBrandMock.mockResolvedValue([calendarRow]);
  getCalendarItemsMock.mockResolvedValue([]);
  getStrategyByIdMock.mockResolvedValue({ name: "QA Campaign" });
  getDesignTicketsForMemberMock.mockResolvedValue([]);
});

async function renderCalendarPage(search: Record<string, string>) {
  render(await CalendarPage({ searchParams: Promise.resolve(search) }));
  return calendarClientProps.current;
}

describe("CalendarPage pick mode", () => {
  it("turns the chooser's link into pick mode", async () => {
    const props = await renderCalendarPage({ pick: "design" });
    expect(props?.pickMode).toBe(true);
  });

  it.each([{}, { pick: "banana" }, { pick: "" }])(
    "stays an ordinary calendar visit for %j",
    async (search) => {
      const props = await renderCalendarPage(search as Record<string, string>);
      expect(props?.pickMode).toBe(false);
    },
  );

  it("still guards on a completed brand profile", async () => {
    requireBrandMock.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(
      CalendarPage({ searchParams: Promise.resolve({ pick: "design" }) }),
    ).rejects.toThrow("NEXT_REDIRECT");
  });

  /* The chooser sends "no content plan yet" users here too. Without pick-aware
     copy they land on a bare empty state with no idea why they arrived. */
  it("explains the empty calendar to someone who came to pick an item", async () => {
    getCalendarsForBrandMock.mockResolvedValue([]);
    const { container } = render(
      await CalendarPage({ searchParams: Promise.resolve({ pick: "design" }) }),
    );
    expect(container.textContent).toContain(
      "no planned posts to request a design for yet",
    );
  });

  it("keeps the ordinary empty-calendar copy for a normal visit", async () => {
    getCalendarsForBrandMock.mockResolvedValue([]);
    const { container } = render(
      await CalendarPage({ searchParams: Promise.resolve({}) }),
    );
    expect(container.textContent).toContain(
      "Generate a content strategy first",
    );
    expect(container.textContent).not.toContain(
      "no planned posts to request a design for yet",
    );
  });
});
