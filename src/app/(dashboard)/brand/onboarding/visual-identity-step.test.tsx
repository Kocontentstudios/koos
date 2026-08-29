import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastSuccess, toastMessage } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, message: toastMessage, error: vi.fn() },
}));

import { VisualIdentityStep } from "./visual-identity-step";

const palette = (primary: string | null, secondary: string | null = null) => ({
  ok: true,
  json: async () => ({ palette: { primary, secondary, accents: [] } }),
});

function renderStep(over: Record<string, unknown> = {}) {
  const onSave = vi.fn();
  const onSkip = vi.fn();
  render(
    <VisualIdentityStep
      brandId="b1"
      onSave={onSave}
      onSkip={onSkip}
      {...over}
    />,
  );
  return { onSave, onSkip };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("VisualIdentityStep", () => {
  it("collects everything the design engine needs", () => {
    renderStep();

    expect(screen.getByText("Your visual identity")).toBeInTheDocument();
    expect(screen.getByLabelText("Primary colour")).toBeInTheDocument();
    expect(screen.getByLabelText("Secondary colour")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Minimalist" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Modern sans-serif" }),
    ).toBeInTheDocument();
  });

  it("offers the style options the ticket names", () => {
    renderStep();
    for (const style of ["Minimalist", "Editorial", "Modern Tech"]) {
      expect(screen.getByRole("button", { name: style })).toBeInTheDocument();
    }
  });

  it("saves what was picked", async () => {
    const user = userEvent.setup();
    const { onSave } = renderStep();

    await user.type(screen.getByLabelText("Primary colour"), "#3A2A1F");
    await user.click(screen.getByRole("button", { name: "Editorial" }));
    await user.click(screen.getByRole("button", { name: "Classic serif" }));
    await user.click(screen.getByRole("button", { name: /save and finish/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryColor: "#3A2A1F",
        brandStyle: "Editorial",
        brandFont: "Classic serif",
      }),
    );
  });

  it("lets a picked option be unpicked", async () => {
    const user = userEvent.setup();
    const { onSave } = renderStep();

    const editorial = screen.getByRole("button", { name: "Editorial" });
    await user.click(editorial);
    expect(editorial).toHaveAttribute("aria-pressed", "true");
    await user.click(editorial);

    await user.click(screen.getByRole("button", { name: /save and finish/i }));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ brandStyle: "" }),
    );
  });

  /* The brand is already captured by this point. The visual step adds to it,
     so it must never be a gate. */
  it("can be skipped", async () => {
    const user = userEvent.setup();
    const { onSkip, onSave } = renderStep();

    await user.click(screen.getByRole("button", { name: /skip for now/i }));
    expect(onSkip).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  describe("colour extraction", () => {
    it("cannot run before a logo is uploaded", () => {
      renderStep();
      expect(
        screen.getByRole("button", { name: /pick from logo/i }),
      ).toBeDisabled();
    });

    it("fills the colour fields from the logo", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => palette("#3A2A1F", "#FAF7F2")),
      );
      const user = userEvent.setup();
      renderStep({ initial: { logoUrl: "https://cdn/logo.png" } });

      await user.click(screen.getByRole("button", { name: /pick from logo/i }));

      await waitFor(() =>
        expect(screen.getByLabelText("Primary colour")).toHaveValue("#3A2A1F"),
      );
      expect(screen.getByLabelText("Secondary colour")).toHaveValue("#FAF7F2");
      expect(toastSuccess).toHaveBeenCalled();
    });

    it("sends the brand and logo it was given", async () => {
      const fetchMock = vi.fn(async () => palette("#111111"));
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();
      renderStep({ initial: { logoUrl: "https://cdn/logo.png" } });

      await user.click(screen.getByRole("button", { name: /pick from logo/i }));

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const [url, init] = fetchMock.mock.calls[0] as unknown as [
        string,
        RequestInit,
      ];
      expect(url).toBe("/api/brand/logo-colors");
      expect(JSON.parse(String(init.body))).toEqual({
        brandId: "b1",
        logoUrl: "https://cdn/logo.png",
      });
    });

    /* Extraction is an offer. A provider that cannot read images, or a logo it
       cannot read, must leave the user typing hexes rather than stuck. */
    it("says so and leaves the fields alone when it finds nothing", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => palette(null, null)),
      );
      const user = userEvent.setup();
      renderStep({ initial: { logoUrl: "https://cdn/logo.png" } });

      await user.click(screen.getByRole("button", { name: /pick from logo/i }));

      await waitFor(() => expect(toastMessage).toHaveBeenCalled());
      expect(screen.getByLabelText("Primary colour")).toHaveValue("");
    });

    it("survives the request failing outright", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("offline");
        }),
      );
      const user = userEvent.setup();
      renderStep({ initial: { logoUrl: "https://cdn/logo.png" } });

      await user.click(screen.getByRole("button", { name: /pick from logo/i }));

      await waitFor(() => expect(toastMessage).toHaveBeenCalled());
      expect(
        screen.getByRole("button", { name: /save and finish/i }),
      ).toBeEnabled();
    });

    it("keeps a colour the model could not identify", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => palette("#3A2A1F", null)),
      );
      const user = userEvent.setup();
      renderStep({
        initial: { logoUrl: "https://cdn/logo.png", secondaryColor: "#ABCDEF" },
      });

      await user.click(screen.getByRole("button", { name: /pick from logo/i }));

      await waitFor(() =>
        expect(screen.getByLabelText("Primary colour")).toHaveValue("#3A2A1F"),
      );
      expect(screen.getByLabelText("Secondary colour")).toHaveValue("#ABCDEF");
    });
  });
});
