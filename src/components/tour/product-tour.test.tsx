import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SidebarCollapseProvider } from "@/components/layout/sidebar-context";
import { TOUR_ANCHORS } from "@/lib/tour/anchors";
import { TOUR_PROMPT, TOUR_STEPS } from "@/lib/tour/steps";
import { ProductTour } from "./product-tour";

const replace = vi.fn();
const captureEvent = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: (name: string, props?: unknown) => captureEvent(name, props),
}));

// base-ui's positioner observes its anchor; jsdom ships neither observer.
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

/** jsdom has no matchMedia; default every query to "desktop, motion fine". */
function stubMatchMedia(mobile: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("max-width") ? mobile : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

let fetchMock: ReturnType<typeof vi.fn>;

function renderTour(startAt: "prompt" | "step" = "prompt") {
  // Real anchor targets so the popover path, not the fallback, is exercised.
  return render(
    <SidebarCollapseProvider>
      <div data-tour={TOUR_ANCHORS.dashboardHero}>hero</div>
      <div data-tour={TOUR_ANCHORS.navBrands}>brands</div>
      <div data-tour={TOUR_ANCHORS.navCampaigns}>campaigns</div>
      <div data-tour={TOUR_ANCHORS.dashboardActions}>actions</div>
      <div data-tour={TOUR_ANCHORS.navDesignTickets}>tickets</div>
      <div data-tour={TOUR_ANCHORS.navSettings}>settings</div>
      <ProductTour startAt={startAt} />
    </SidebarCollapseProvider>,
  );
}

async function advanceTo(title: string) {
  while (screen.queryByRole("heading", { name: title }) === null) {
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
  }
}

function lastPostBody() {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("expected a POST to /api/tour/complete");
  return JSON.parse((call[1] as { body: string }).body);
}

describe("ProductTour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    stubMatchMedia(false);
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("offers the tour with the ticket's copy", () => {
    renderTour();
    expect(
      screen.getByRole("heading", { name: TOUR_PROMPT.headline }),
    ).toBeInTheDocument();
    expect(screen.getByText(TOUR_PROMPT.body)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TOUR_PROMPT.start }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: TOUR_PROMPT.skip }),
    ).toBeInTheDocument();
  });

  it("resolves the tour when the user skips", async () => {
    renderTour();
    await userEvent.click(
      screen.getByRole("button", { name: TOUR_PROMPT.skip }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tour/complete",
      expect.objectContaining({ method: "POST" }),
    );
    expect(lastPostBody().reason).toBe("skipped");
    expect(
      screen.queryByRole("heading", { name: TOUR_PROMPT.headline }),
    ).toBeNull();
  });

  it("starts at the first step", async () => {
    renderTour();
    await userEvent.click(
      screen.getByRole("button", { name: TOUR_PROMPT.start }),
    );
    expect(
      screen.getByRole("heading", { name: "Your Dashboard" }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 of 7")).toBeInTheDocument();
  });

  it("walks every step through to the finish card", async () => {
    renderTour();
    await userEvent.click(
      screen.getByRole("button", { name: TOUR_PROMPT.start }),
    );
    for (const step of TOUR_STEPS.slice(1)) {
      await userEvent.click(screen.getByRole("button", { name: "Next" }));
      expect(
        screen.getByRole("heading", { name: step.title }),
      ).toBeInTheDocument();
    }
    const finish = screen.getByRole("button", { name: "Finish Tour" });
    await userEvent.click(finish);
    expect(lastPostBody().reason).toBe("completed");
    expect(screen.queryByRole("button", { name: "Finish Tour" })).toBeNull();
  });

  it("steps backwards", async () => {
    renderTour("step");
    await advanceTo("Create Campaigns");
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("heading", { name: "Your Brand Profile" }),
    ).toBeInTheDocument();
  });

  it("resolves the tour on Escape", async () => {
    renderTour();
    await userEvent.click(
      screen.getByRole("button", { name: TOUR_PROMPT.start }),
    );
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(lastPostBody().reason).toBe("escape"));
    expect(
      screen.queryByRole("heading", { name: "Your Dashboard" }),
    ).toBeNull();
  });

  it("resolves the tour when closed with the X", async () => {
    renderTour();
    await userEvent.click(screen.getByRole("button", { name: "Close tour" }));
    expect(lastPostBody().reason).toBe("closed");
  });

  it("posts exactly once however many exits are triggered", async () => {
    renderTour();
    await userEvent.click(
      screen.getByRole("button", { name: TOUR_PROMPT.skip }),
    );
    await userEvent.keyboard("{Escape}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("replays without the prompt and without rewriting the timestamp", async () => {
    renderTour("step");
    expect(
      screen.queryByRole("heading", { name: TOUR_PROMPT.headline }),
    ).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Your Dashboard" }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close tour" }));
    expect(fetchMock).not.toHaveBeenCalled();
    // Otherwise a refresh would relaunch the replay forever.
    expect(replace).toHaveBeenCalledWith("/dashboard");
  });

  it("resumes where a refresh interrupted it", () => {
    window.sessionStorage.setItem(
      "koos_tour_step",
      JSON.stringify({ v: 1, index: 3 }),
    );
    renderTour();
    expect(
      screen.getByRole("heading", { name: "Request a Design" }),
    ).toBeInTheDocument();
  });

  it("ignores a corrupt resume cursor", () => {
    window.sessionStorage.setItem("koos_tour_step", "{{{");
    renderTour();
    expect(
      screen.getByRole("heading", { name: TOUR_PROMPT.headline }),
    ).toBeInTheDocument();
  });

  it("still closes when the network call fails", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    renderTour();
    await userEvent.click(
      screen.getByRole("button", { name: TOUR_PROMPT.skip }),
    );
    expect(
      screen.queryByRole("heading", { name: TOUR_PROMPT.headline }),
    ).toBeNull();
  });

  /* Guards the rest of this suite: the anchored popover and the centered
     fallback render an identical card, so without this every assertion above
     could be passing against the fallback and nobody would notice. */
  it("uses the anchored popover when the anchor is present", async () => {
    renderTour("step");
    await screen.findByRole("heading", { name: "Your Dashboard" });
    await waitFor(() =>
      expect(document.querySelectorAll("[data-side]").length).toBeGreaterThan(
        0,
      ),
    );
    expect(captureEvent).not.toHaveBeenCalledWith(
      "product_tour_anchor_missing",
      expect.anything(),
    );
  });

  it("highlights the element the current step points at, and only that one", async () => {
    renderTour("step");
    await screen.findByRole("heading", { name: "Your Dashboard" });
    await waitFor(() =>
      expect(document.querySelectorAll(".koos-tour-highlight")).toHaveLength(1),
    );
    expect(
      document.querySelector(`[data-tour="${TOUR_ANCHORS.dashboardHero}"]`),
    ).toHaveClass("koos-tour-highlight");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(
        document.querySelector(`[data-tour="${TOUR_ANCHORS.navBrands}"]`),
      ).toHaveClass("koos-tour-highlight"),
    );
    // The previous step must let go, or the tour lights up the whole app.
    expect(
      document.querySelector(`[data-tour="${TOUR_ANCHORS.dashboardHero}"]`),
    ).not.toHaveClass("koos-tour-highlight");
  });

  it("leaves no highlight behind when the tour ends", async () => {
    renderTour("step");
    await screen.findByRole("heading", { name: "Your Dashboard" });
    await waitFor(() =>
      expect(document.querySelectorAll(".koos-tour-highlight")).toHaveLength(1),
    );
    await userEvent.click(screen.getByRole("button", { name: "Close tour" }));
    await waitFor(() =>
      expect(document.querySelectorAll(".koos-tour-highlight")).toHaveLength(0),
    );
  });

  it("delivers the copy even when the anchor is missing", async () => {
    render(
      <SidebarCollapseProvider>
        <ProductTour startAt="step" />
      </SidebarCollapseProvider>,
    );
    expect(
      await screen.findByRole("heading", { name: "Your Dashboard" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(captureEvent).toHaveBeenCalledWith("product_tour_anchor_missing", {
        anchor_id: TOUR_ANCHORS.dashboardHero,
      }),
    );
  });

  it("announces each step for screen readers", async () => {
    renderTour("step");
    expect(screen.getByText("Step 1 of 7: Your Dashboard")).toBeInTheDocument();
  });

  it("opens the mobile drawer for sidebar steps and closes it otherwise", async () => {
    stubMatchMedia(true);
    renderTour("step");
    await advanceTo("Your Brand Profile");
    // The provider locks body scroll while the drawer is open, which is the
    // observable effect of openMobile() without mocking the context.
    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
    await advanceTo("Request a Design");
    await waitFor(() =>
      expect(document.body.style.overflow).not.toBe("hidden"),
    );
  });
});
