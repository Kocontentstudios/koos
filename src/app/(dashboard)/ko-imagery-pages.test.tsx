import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useKoImageryOffered } from "@/components/design/directions/ko-imagery-context";

/* Oluwaseyi's ruling, 2026-10-27: the image-choice dialog offers KO imagery
   only while FEATURE_KO_IMAGERY is on. The flag is read on the server, so
   each page that can open the dialog must hand it down. The calendar page is
   covered in calendar/page.test.tsx. */

const seen = vi.hoisted(() => ({
  studio: null as boolean | null,
  strategy: null as boolean | null,
}));

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
    brand: { id: "brand-1", name: "Lagos Loom" },
  })),
}));
vi.mock("@/lib/db/queries", () => ({
  getActiveBrandForMember: vi.fn(async () => ({
    id: "brand-1",
    name: "Lagos Loom",
  })),
  listDesignGenerationsForBrand: vi.fn(async () => []),
  getStrategiesByBrand: vi.fn(async () => []),
  getRecentConversationsForBrand: vi.fn(async () => []),
}));
vi.mock("./design-studio/design-studio-client", () => ({
  DesignStudioClient: () => {
    seen.studio = useKoImageryOffered();
    return null;
  },
}));
vi.mock("./strategy/strategy-client", () => ({
  StrategyClient: () => {
    seen.strategy = useKoImageryOffered();
    return null;
  },
}));

import DesignStudioPage from "./design-studio/page";
import StrategyPage from "./strategy/page";

beforeEach(() => {
  seen.studio = null;
  seen.strategy = null;
});
afterEach(() => vi.unstubAllEnvs());

describe.each([
  ["1", true],
  ["true", true],
  ["", false],
  ["off", false],
])("FEATURE_KO_IMAGERY=%j", (value, offered) => {
  beforeEach(() => vi.stubEnv("FEATURE_KO_IMAGERY", value));

  it(`reaches Design Studio's image choice as ${offered}`, async () => {
    render(await DesignStudioPage());
    expect(seen.studio).toBe(offered);
  });

  it(`reaches the strategy brief panel's image choice as ${offered}`, async () => {
    render(await StrategyPage({ searchParams: Promise.resolve({}) }));
    expect(seen.strategy).toBe(offered);
  });
});
