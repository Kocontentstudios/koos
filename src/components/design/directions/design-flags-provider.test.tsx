import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
/* The job never reports: the wait the user sees is the one the dialog
   opened on its own knowledge, before any progress. */
const pollGenerationJob = vi.fn(() => new Promise<never>(() => {}));
vi.mock("@/lib/generation/poll-job", () => ({
  pollGenerationJob: (...a: unknown[]) => pollGenerationJob(...(a as [])),
}));

import { GenerateDesignButton } from "@/components/design/generate-design-button";
import { plannedOutline } from "@/components/design/sequence/fixtures";
import { DesignFlagsProvider } from "./design-flags-provider";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";

/* The real chain a brief panel mounts: server-read flags, the shared
   launcher, the real run hook. Only the network is stood in for. */
async function startFromBrief(designType: string) {
  render(
    <DesignFlagsProvider>
      <GenerateDesignButton
        brandId={BRAND}
        briefId="brief-1"
        ticketContext={{ briefId: "brief-1", designType }}
      />
    </DesignFlagsProvider>,
  );
  await userEvent.click(
    screen.getByRole("button", { name: /generate design/i }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /let ko create the imagery/i }),
  );
}

/* A set stops at its outline first; approve it as planned. */
async function approveOutline() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: /^Generate \d+ slides · \d+ units$/,
    }),
  );
}

const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
  url === "/api/design/outline"
    ? Response.json({ outline: plannedOutline(5) })
    : Response.json({ jobId: "job-1" }, { status: 202 }),
);

function callsTo(url: string) {
  return fetchMock.mock.calls.filter(([called]) => called === url);
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  vi.stubEnv("FEATURE_KO_IMAGERY", "1");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("a carousel brief started from a page that hands the flags down", () => {
  it("opens on the set's own wait when FEATURE_MULTI_FRAME is on", async () => {
    vi.stubEnv("FEATURE_MULTI_FRAME", "1");
    await startFromBrief("Instagram carousel");
    expect(pollGenerationJob).not.toHaveBeenCalled();
    await approveOutline();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent?.includes("Planning your carousel…")),
      ).toBe(true),
    );
    expect(screen.queryByText(/two directions/i)).toBeNull();
    const [, init] = callsTo("/api/design/generate")[0] ?? [];
    const body = JSON.parse(String(init?.body));
    expect(body.approvedOutline.kind).toBe("carousel");
    expect(body.approvedOutline.points).toHaveLength(5);
    expect(callsTo("/api/design/outline")).toHaveLength(1);
  });

  it("names a presentation as one", async () => {
    vi.stubEnv("FEATURE_MULTI_FRAME", "1");
    await startFromBrief("Presentation");
    await approveOutline();
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .some((s) => s.textContent?.includes("Planning your presentation…")),
      ).toBe(true),
    );
  });

  it("keeps the directions wait it always had with the flag off", async () => {
    vi.stubEnv("FEATURE_MULTI_FRAME", "");
    await startFromBrief("Instagram carousel");
    await waitFor(() => expect(pollGenerationJob).toHaveBeenCalled());
    expect(screen.queryByText(/Planning your carousel/)).toBeNull();
    expect(callsTo("/api/design/outline")).toHaveLength(0);
    const [, init] = callsTo("/api/design/generate")[0] ?? [];
    expect(JSON.parse(String(init?.body))).not.toHaveProperty(
      "approvedOutline",
    );
  });
});
