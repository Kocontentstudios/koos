import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DesignPreviewModal } from "./design-preview-modal";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const generation = {
  id: "g1",
  url: "https://example.test/g1.png",
  renderer: "composite" as const,
  prompt: "A launch poster",
  createdAt: new Date("2026-08-26T10:00:00.000Z").toISOString(),
};

function renderModal(overrides = {}) {
  return render(
    <DesignPreviewModal
      open
      onOpenChange={vi.fn()}
      brandId="b1"
      generations={[generation as never]}
      pending={false}
      progressLabel={null}
      error={null}
      {...overrides}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DesignPreviewModal send action", () => {
  /* Regression: this button swapped its own label to "Sending…" but never
     showed a spinner, so it was the one action in the app whose pending state
     didn't match the rest. It now uses Button's own loading prop. */
  it("shows a spinner and disables itself while sending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<never>(() => {})),
    );
    const user = userEvent.setup();
    renderModal();

    const send = screen.getByRole("button", { name: /Send to design team/ });
    expect(send).toBeEnabled();
    await user.click(send);

    const busy = await screen.findByRole("button", { name: /Sending…/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
  });

  it("stays disabled while a generation is still running", () => {
    renderModal({ pending: true, progressLabel: "Generating…" });
    expect(
      screen.getByRole("button", { name: /Send to design team/ }),
    ).toBeDisabled();
  });
});

describe("DesignPreviewModal download", () => {
  /* The regression this feature exists for: the button linked at the public R2
     URL with a `download` attribute, which browsers ignore cross-origin — so
     clicking it navigated to the PNG instead of saving it. */
  it("downloads through a same-origin route, not the storage URL", () => {
    renderModal();
    const link = screen.getByRole("link", { name: /download/i });
    expect(link).toHaveAttribute("href", "/api/design/generations/g1/download");
    expect(link.getAttribute("href")).not.toContain("example.test");
  });

  /* A file download must stay a real link, and a button inside an anchor is
     invalid content — the brand page already says so in a comment. */
  it("offers the download as a link, not a button inside one", () => {
    renderModal();
    expect(
      screen.getByRole("link", { name: /download/i }).querySelector("button"),
    ).toBeNull();
  });

  it("states the resolution it is about to save", () => {
    renderModal({
      generations: [{ ...generation, width: 1080, height: 1350 } as never],
    });
    expect(
      screen.getByRole("link", { name: /download 1080 × 1350/i }),
    ).toBeInTheDocument();
  });

  /* Rows written before dimensions were read carry none, and a guessed size in
     the label would be a lie the user could act on. */
  it("says just Download when the size is unknown", () => {
    renderModal();
    const link = screen.getByRole("link", { name: /download/i });
    expect(link.textContent).not.toMatch(/\d+ × \d+/);
  });

  /* Viewing an existing design from the grid: nothing to regenerate. */
  it("hides Regenerate when no handler is given", () => {
    renderModal({ onRegenerate: undefined });
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    expect(screen.getByRole("link", { name: /download/i })).toBeInTheDocument();
  });

  it("offers no download while a generation is still running", () => {
    renderModal({ generations: [], pending: true });
    expect(screen.queryByRole("link", { name: /download/i })).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  /* A successful download does not navigate, but a 404 or an expired session
     returns JSON — without this the tab leaves the modal and the page behind. */
  it("opens the download away from the page it was started from", () => {
    renderModal();
    const link = screen.getByRole("link", { name: /download/i });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("tells screen-reader users the link opens elsewhere", () => {
    renderModal();
    expect(
      screen.getByRole("link", { name: /opens in a new tab/i }),
    ).toBeInTheDocument();
  });
});
