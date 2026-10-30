import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKoImageryOffered } from "@/components/design/directions/ko-imagery-context";
import { useMultiFrameOffered } from "@/components/design/directions/multi-frame-context";

/* KOOS-AI-002 round 3 H1: FEATURE_MULTI_FRAME is read on the server, and
   the dialog opens a set's wait ("Planning your carousel…") and reads a
   two-frame carousel as a set only when the page handed the flag down. A
   provider that exists but is mounted nowhere left every one of those
   false in the product, so each page that opens the dialog is checked. */

type Seen = { multiFrame: boolean | null; koImagery: boolean | null };
const seen = vi.hoisted(() => ({
  studio: { multiFrame: null, koImagery: null } as Seen,
  strategy: { multiFrame: null, koImagery: null } as Seen,
  calendar: { multiFrame: null, koImagery: null } as Seen,
}));

function Probe({ into }: { into: Seen }) {
  into.multiFrame = useMultiFrameOffered();
  into.koImagery = useKoImageryOffered();
  return null;
}

vi.mock("@/lib/auth/redirects", () => ({ redirectToLogin: vi.fn() }));
vi.mock("@/lib/auth/require-open-workspace", () => ({
  requireOpenWorkspace: vi.fn(async () => ({
    dbUser: { id: "user-1" },
    workspace: { id: "ws-1" },
  })),
}));
vi.mock("@/lib/auth/require-brand", () => ({
  requireBrand: vi.fn(async () => ({
    dbUser: { id: "user-1" },
    workspace: { id: "ws-1" },
    role: "owner",
    brand: { id: "brand-1", name: "Lagos Loom" },
  })),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: vi.fn(async () => ({
    id: "brand-1",
    name: "Lagos Loom",
  })),
  listDesignGenerationsForBrand: vi.fn(async () => []),
  listSetFrames: vi.fn(async () => []),
  getStrategiesByBrand: vi.fn(async () => []),
  getRecentConversationsForBrand: vi.fn(async () => []),
  getCalendarsForBrand: vi.fn(async () => [
    {
      calendar: {
        id: "cal-1",
        strategyId: "strategy-1",
        brandId: "brand-1",
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-08-31T00:00:00.000Z"),
      },
      strategyName: "Launch",
    },
  ]),
  getCalendarItems: vi.fn(async () => []),
  getStrategyById: vi.fn(async () => ({ name: "Launch" })),
  getDesignTicketsForMember: vi.fn(async () => []),
}));
vi.mock("./design-studio/design-studio-client", () => ({
  DesignStudioClient: () => <Probe into={seen.studio} />,
}));
vi.mock("./strategy/strategy-client", () => ({
  StrategyClient: () => <Probe into={seen.strategy} />,
}));
vi.mock("./calendar/calendar-client", () => ({
  CalendarClient: () => <Probe into={seen.calendar} />,
}));

import CalendarPage from "./calendar/page";
import DesignStudioPage from "./design-studio/page";
import StrategyPage from "./strategy/page";

const pages = {
  studio: async () => render(await DesignStudioPage()),
  strategy: async () =>
    render(await StrategyPage({ searchParams: Promise.resolve({}) })),
  calendar: async () =>
    render(await CalendarPage({ searchParams: Promise.resolve({}) })),
} as const;

beforeEach(() => {
  for (const into of Object.values(seen)) {
    into.multiFrame = null;
    into.koImagery = null;
  }
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["1", true],
  ["on", true],
  ["", false],
  ["0", false],
])("FEATURE_MULTI_FRAME=%j", (value, offered) => {
  beforeEach(() => vi.stubEnv("FEATURE_MULTI_FRAME", value));

  it.each(Object.keys(pages) as (keyof typeof pages)[])(
    `reaches the %s page's image choice as ${offered}`,
    async (page) => {
      await pages[page]();
      expect(seen[page].multiFrame).toBe(offered);
    },
  );
});

/* One provider carries both flags now; neither may ride on the other. */
it.each(Object.keys(pages) as (keyof typeof pages)[])(
  "keeps the %s page's FEATURE_KO_IMAGERY independent of FEATURE_MULTI_FRAME",
  async (page) => {
    vi.stubEnv("FEATURE_MULTI_FRAME", "1");
    vi.stubEnv("FEATURE_KO_IMAGERY", "");
    await pages[page]();
    expect(seen[page]).toEqual({ multiFrame: true, koImagery: false });
  },
);
