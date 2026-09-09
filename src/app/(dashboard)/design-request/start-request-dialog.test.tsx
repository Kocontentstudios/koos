import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StartRequestDialog } from "./start-request-dialog";

const { captureEventMock } = vi.hoisted(() => ({ captureEventMock: vi.fn() }));
vi.mock("@/lib/analytics/posthog-client", () => ({
  captureEvent: captureEventMock,
}));

beforeEach(() => {
  vi.resetAllMocks();
});

describe("StartRequestDialog", () => {
  it("renders the trigger with the given label", () => {
    render(<StartRequestDialog label="New Request" />);
    expect(
      screen.getByRole("button", { name: "New Request" }),
    ).toBeInTheDocument();
  });

  /* The whole point of the feature: the button must not navigate. If the
     options were rendered up-front we could not prove the click was intercepted. */
  it("shows no options until the trigger is clicked", () => {
    render(<StartRequestDialog label="New Request" />);
    expect(
      screen.queryByRole("link", { name: /Request a new design/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Choose from Content Calendar/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Start a new campaign/ }),
    ).not.toBeInTheDocument();
  });

  it("opens a chooser asking how to start", async () => {
    const user = userEvent.setup();
    render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));
    expect(
      screen.getByRole("heading", { name: "How do you want to start?" }),
    ).toBeInTheDocument();
  });

  it.each([
    [/Request a new design/, "/design-request/new"],
    [/Choose from Content Calendar/, "/calendar?pick=design&view=agenda"],
    [/Start a new campaign/, "/strategy"],
  ])("links %s to %s", async (name, href) => {
    const user = userEvent.setup();
    render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  });

  it("closes without starting a request", async () => {
    const user = userEvent.setup();
    render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByRole("link", { name: /Request a new design/ }),
    ).not.toBeInTheDocument();
    expect(captureEventMock).not.toHaveBeenCalledWith(
      "design_request_start_selected",
      expect.anything(),
    );
  });

  it("closes on Escape without starting a request", async () => {
    const user = userEvent.setup();
    render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("link", { name: /Request a new design/ }),
    ).not.toBeInTheDocument();
    expect(captureEventMock).not.toHaveBeenCalledWith(
      "design_request_start_selected",
      expect.anything(),
    );
  });

  /* Without an open event the chooser's abandon rate is unmeasurable, which is
     the only evidence for "simple, not overwhelming". */
  it("reports which trigger opened the chooser", async () => {
    const user = userEvent.setup();
    render(<StartRequestDialog label="Request a Design" />);
    await user.click(screen.getByRole("button", { name: "Request a Design" }));
    expect(captureEventMock).toHaveBeenCalledWith(
      "design_request_start_opened",
      { label: "Request a Design" },
    );
  });

  /* The campaign option is a detour out of the request flow, so it must stay
     visually separated rather than reading as a third equal choice. */
  it("separates the campaign detour from the two request paths", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));
    const separator = baseElement.querySelector("[data-slot='separator']");
    if (!separator) throw new Error("expected a separator in the dialog");

    const campaign = screen.getByRole("link", { name: /Start a new campaign/ });
    const campaignFollowsSeparator = Boolean(
      separator.compareDocumentPosition(campaign) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(campaignFollowsSeparator).toBe(true);
  });

  it("reports which start path was chosen", async () => {
    const user = userEvent.setup();
    render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));
    await user.click(
      screen.getByRole("link", { name: /Choose from Content Calendar/ }),
    );
    expect(captureEventMock).toHaveBeenCalledWith(
      "design_request_start_selected",
      { option: "calendar" },
    );
  });

  /* jsdom computes no layout, so the popup's sizing contract can only be
     pinned as classes. Every token below was verified by measuring the real
     dialog in Chromium at 568x320, 667x375, 320x568, 390x844 and 1280x800.
     Deleting any of the first six puts the title, the close button, or "Start
     a new campaign" off-screen while the whole suite stays green; the last is
     ergonomics rather than breakage. Treat a failure here as "re-measure in a
     browser", not "update the string".

     A browser-driven gate test would assert the geometry directly, but this
     repo has no e2e lane; see the note in the PR. */
  it.each([
    [
      "grid-rows-[minmax(0,1fr)]",
      "bounds the grid track so the inner wrapper can scroll at all",
    ],
    [
      "overflow-y-auto",
      "makes the options scrollable once the popup is capped",
    ],
    [
      "sm:max-h-[90vh]",
      "keeps the popup inside short desktop/landscape windows",
    ],
    [
      "max-sm:max-h-[85vh]",
      "keeps the phone sheet from growing past the screen",
    ],
    [
      "max-sm:inset-x-0",
      "spans the sheet edge-to-edge instead of leaving left-1/2 in force",
    ],
    [
      "max-sm:translate-x-0",
      "cancels the base -translate-x-1/2 that would shove half the sheet off the left edge",
    ],
    [
      "max-sm:translate-y-0",
      "cancels the base -translate-y-1/2 that lifts the close button off the top",
    ],
    // Ergonomics, not breakage: without it the sheet merely re-anchors to the top.
    ["max-sm:bottom-0", "keeps it a bottom sheet, within thumb reach"],
  ])("keeps %s — %s", async (className) => {
    const user = userEvent.setup();
    const { baseElement } = render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));

    const popup = baseElement.querySelector("[data-slot='dialog-content']");
    const scroller = popup?.querySelector(".overflow-y-auto");
    const markup = `${popup?.className ?? ""} ${scroller?.className ?? ""}`;
    expect(markup).toContain(className);
  });

  it("scrolls the contents rather than the popup, so the close stays put", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<StartRequestDialog label="New Request" />);
    await user.click(screen.getByRole("button", { name: "New Request" }));

    const popup = baseElement.querySelector("[data-slot='dialog-content']");
    /* The close button is positioned against the popup; if the popup itself
       scrolled, the X would ride away with the content. */
    expect(popup?.className).not.toContain("overflow-y-auto");
    expect(
      popup
        ?.querySelector(".overflow-y-auto")
        ?.contains(screen.getByRole("link", { name: /Start a new campaign/ })),
    ).toBe(true);
  });
});
