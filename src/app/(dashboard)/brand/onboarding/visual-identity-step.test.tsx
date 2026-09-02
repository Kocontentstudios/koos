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

import { MAX_ADDITIONAL_COLORS } from "@/lib/brand-profile";
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

/* An uploaded face is checked by signature server-side; the client's job is to
   send it under the right kind and surface the refusal. */
describe("VisualIdentityStep font upload", () => {
  const ttf = () =>
    new File([new Uint8Array([0x00, 0x01, 0x00, 0x00])], "brand.ttf", {
      type: "font/ttf",
    });

  it("uploads a font under the font kind", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: "https://cdn/fonts/u1/brand.ttf" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderStep();

    const inputs = screen.getAllByTestId("file-input");
    await user.upload(inputs[inputs.length - 1], ttf());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1].body as FormData;
    expect(body.get("kind")).toBe("font");
  });

  it("saves the uploaded font URL with the rest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ url: "https://cdn/fonts/u1/brand.ttf" }),
      })),
    );
    const user = userEvent.setup();
    const { onSave } = renderStep();

    const inputs = screen.getAllByTestId("file-input");
    await user.upload(inputs[inputs.length - 1], ttf());
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await user.click(screen.getByRole("button", { name: /save and finish/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        brandFontUrl: "https://cdn/fonts/u1/brand.ttf",
      }),
    );
  });

  /* The server rejects a WOFF2 because satori cannot render it; the user has
     to be told why rather than left with a silently empty field. */
  it("surfaces the server's reason for refusing a file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error: "That does not look like a TTF or OTF font file.",
        }),
      })),
    );
    const user = userEvent.setup();
    renderStep();

    const inputs = screen.getAllByTestId("file-input");
    await user.upload(inputs[inputs.length - 1], ttf());

    expect(
      await screen.findByText(/does not look like a TTF or OTF/),
    ).toBeInTheDocument();
  });

  /* Typography is optional: the style picker alone is a complete answer. */
  it("saves without a font file at all", async () => {
    const user = userEvent.setup();
    const { onSave } = renderStep();

    await user.click(screen.getByRole("button", { name: "Classic serif" }));
    await user.click(screen.getByRole("button", { name: /save and finish/i }));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ brandFont: "Classic serif", brandFontUrl: "" }),
    );
  });

  describe("brand colours", () => {
    it("offers a colour wheel beside each colour field", () => {
      renderStep();
      expect(
        screen.getByRole("button", { name: "Pick Primary colour" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Pick Secondary colour" }),
      ).toBeInTheDocument();
    });

    /* The chat stores what the user said. "forest green" reaching this step
       must survive it — the paid onboarding eval asserts primaryColor
       contains "green". */
    it("keeps a colour the conversation captured as a name", async () => {
      const user = userEvent.setup();
      const { onSave } = renderStep({
        initial: { primaryColor: "forest green" },
      });

      expect(screen.getByLabelText("Primary colour")).toHaveValue(
        "forest green",
      );
      await user.click(
        screen.getByRole("button", { name: /save and finish/i }),
      );

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ primaryColor: "forest green" }),
      );
    });

    it("survives a colour name being typed, blurred and saved", async () => {
      const user = userEvent.setup();
      const { onSave } = renderStep();

      const primary = screen.getByLabelText("Primary colour");
      await user.click(primary);
      await user.keyboard("forest green");
      await user.tab();

      expect(primary).toHaveValue("forest green");
      await user.click(
        screen.getByRole("button", { name: /save and finish/i }),
      );
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ primaryColor: "forest green" }),
      );
    });

    it("does not seed a colour the user never chose", async () => {
      const user = userEvent.setup();
      const { onSave } = renderStep();

      await user.click(screen.getByRole("button", { name: "Add colour" }));
      await user.click(
        screen.getByRole("button", { name: /save and finish/i }),
      );

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ additionalColors: [""] }),
      );
    });

    it("adds additional colours up to the cap, then stops offering", async () => {
      const user = userEvent.setup();
      renderStep();

      const add = () => screen.getByRole("button", { name: "Add colour" });
      for (let i = 1; i <= MAX_ADDITIONAL_COLORS; i++) {
        await user.click(add());
        const row = screen.getByLabelText(`Additional ${i} colour`);
        expect(row).toBeInTheDocument();
        await user.type(row, `#00000${i}`);
        await user.tab();
      }
      expect(
        screen.queryByRole("button", { name: "Add colour" }),
      ).not.toBeInTheDocument();
    });

    it("removes an additional colour", async () => {
      const user = userEvent.setup();
      renderStep();

      await user.click(screen.getByRole("button", { name: "Add colour" }));
      expect(screen.getByLabelText("Additional 1 colour")).toBeInTheDocument();

      await user.click(
        screen.getByRole("button", { name: "Remove additional colour 1" }),
      );
      expect(screen.queryByLabelText("Additional 1")).not.toBeInTheDocument();
    });

    /* The chat can write a name into any colour column, so no row on this
       screen may revert one. */
    it("keeps a colour name in an additional row", async () => {
      const user = userEvent.setup();
      const { onSave } = renderStep();

      await user.click(screen.getByRole("button", { name: "Add colour" }));
      const row = screen.getByLabelText("Additional 1 colour");
      await user.type(row, "terracotta");
      await user.tab();

      expect(row).toHaveValue("terracotta");
      await user.click(
        screen.getByRole("button", { name: /save and finish/i }),
      );
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ additionalColors: ["terracotta"] }),
      );
    });

    it("keeps a colour name in the primary field", async () => {
      const user = userEvent.setup();
      const { onSave } = renderStep();

      await user.type(screen.getByLabelText("Primary colour"), "forest green");
      await user.click(
        screen.getByRole("button", { name: /save and finish/i }),
      );

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ primaryColor: "forest green" }),
      );
    });

    it("saves the additional colours alongside primary and secondary", async () => {
      const user = userEvent.setup();
      const { onSave } = renderStep({ initial: { primaryColor: "#3A2A1F" } });

      await user.click(screen.getByRole("button", { name: "Add colour" }));
      const extra = screen.getByLabelText("Additional 1 colour");
      await user.clear(extra);
      await user.type(extra, "#22C55E");
      await user.click(
        screen.getByRole("button", { name: /save and finish/i }),
      );

      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryColor: "#3A2A1F",
          additionalColors: ["#22C55E"],
        }),
      );
    });
  });
});
