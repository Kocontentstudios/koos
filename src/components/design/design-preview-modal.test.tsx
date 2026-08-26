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
