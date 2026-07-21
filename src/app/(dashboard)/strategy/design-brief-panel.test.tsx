import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedDesignBrief } from "./design-brief-card";
import { DesignBriefPanel } from "./design-brief-panel";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const brief: PersistedDesignBrief = {
  id: "brief-1",
  title: "Summer Sale Carousel",
  designType: "Instagram Carousel (1080x1350 per slide)",
  dimensions: "1080x1350",
  slides: 5,
  briefMarkdown: "**Title**\nSummer Sale",
  notes: "Keep it bold",
  ticketId: null,
  createdAt: "2026-07-21T10:00:00.000Z",
};

// Desktop panel collapsed + mobile drawer open renders PanelContent exactly
// once, so queries don't see duplicates.
function renderPanel(
  overrides: Partial<React.ComponentProps<typeof DesignBriefPanel>> = {},
) {
  const props: React.ComponentProps<typeof DesignBriefPanel> = {
    brief,
    brandId: "b-1",
    collapsed: true,
    onToggleCollapsed: () => {},
    onClose: () => {},
    onBriefUpdated: () => {},
    mobileOpen: true,
    onMobileClose: () => {},
    ...overrides,
  };
  return render(<DesignBriefPanel {...props} />);
}

describe("DesignBriefPanel", () => {
  it("renders the brief's content", () => {
    renderPanel();
    expect(screen.getByText("Summer Sale Carousel")).toBeInTheDocument();
    expect(screen.getByText("Keep it bold")).toBeInTheDocument();
  });

  it("saves edits via PATCH and reports the updated brief", async () => {
    const user = userEvent.setup();
    const updated = { ...brief, title: "Winter Sale Carousel" };
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ brief: updated }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onBriefUpdated = vi.fn();
    renderPanel({ onBriefUpdated });

    await user.click(screen.getByRole("button", { name: /edit brief/i }));
    const title = screen.getByLabelText(/title/i);
    await user.clear(title);
    await user.type(title, "Winter Sale Carousel");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/design-briefs/brief-1",
        expect.objectContaining({ method: "PATCH" }),
      );
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.title).toBe("Winter Sale Carousel");
    expect(onBriefUpdated).toHaveBeenCalledWith(updated);
  });

  it("copies the brief markdown to the clipboard", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("button", { name: /copy brief/i }));
    await expect(navigator.clipboard.readText()).resolves.toBe(
      "**Title**\nSummer Sale",
    );
  });

  it("submits a ticket carrying the briefId and marks the brief submitted", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ticket: { id: "t-9", ticketNumber: 42 } }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onBriefUpdated = vi.fn();
    renderPanel({ onBriefUpdated });

    await user.click(screen.getByRole("button", { name: /request design/i }));

    await waitFor(() => {
      expect(screen.getByText(/sent to the/i)).toBeInTheDocument();
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.briefId).toBe("brief-1");
    expect(body.brief).toBe("**Title**\nSummer Sale");
    expect(onBriefUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ id: "brief-1", ticketId: "t-9" }),
    );
    // The brief stays reusable: it can be submitted again.
    expect(
      screen.getByRole("button", { name: /submit again/i }),
    ).toBeInTheDocument();
  });
});
