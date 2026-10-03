import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLogoVariation = vi.fn();
const setDefaultLogoVariation = vi.fn();
const removeLogoVariation = vi.fn();
vi.mock("./actions", () => ({
  addLogoVariation: (input: unknown) => addLogoVariation(input),
  setDefaultLogoVariation: (b: string, a: string) =>
    setDefaultLogoVariation(b, a),
  removeLogoVariation: (b: string, a: string) => removeLogoVariation(b, a),
}));

const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (m: string) => toastError(m), success: vi.fn() },
}));

import { LogoVariations } from "./logo-variations";

const stacked = {
  id: "a1",
  fileUrl: "https://cdn.example.test/logos/u1/stacked.png",
  fileName: "stacked.png",
  label: "Stacked mark",
  logoVariant: "vertical" as const,
  logoBackground: "dark" as const,
  isPreferred: false,
};

const icon = {
  id: "a2",
  fileUrl: "https://cdn.example.test/logos/u1/icon.png",
  fileName: "icon.png",
  label: null,
  logoVariant: "icon" as const,
  logoBackground: "any" as const,
  isPreferred: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  addLogoVariation.mockResolvedValue({ ok: true });
  setDefaultLogoVariation.mockResolvedValue({ ok: true });
  removeLogoVariation.mockResolvedValue({ ok: true });
  fetchMock = vi.fn(
    async () =>
      new Response(
        JSON.stringify({ url: "https://cdn.example.test/logos/u1/new.png" }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LogoVariations", () => {
  /* "Each variation can be identified and managed independently." A list of
     identical thumbnails is not identification. */
  it("names each variation so they can be told apart", () => {
    render(<LogoVariations brandId="b1" initial={[stacked, icon]} />);

    expect(
      within(screen.getByTestId("variation-a1")).getByText("Stacked mark"),
    ).toBeInTheDocument();
    // No label of its own, so it falls back to its shape rather than a filename.
    expect(
      within(screen.getByTestId("variation-a2")).getByText(/icon \/ mark/i),
    ).toBeInTheDocument();
  });

  it("shows which one is the default", () => {
    render(<LogoVariations brandId="b1" initial={[stacked, icon]} />);

    const preferred = screen.getByTestId("variation-a2");
    expect(preferred).toHaveTextContent(/default/i);
  });

  it("makes another variation the default", async () => {
    render(<LogoVariations brandId="b1" initial={[stacked, icon]} />);

    await userEvent.click(
      screen.getByRole("button", { name: /make stacked mark the default/i }),
    );

    expect(setDefaultLogoVariation).toHaveBeenCalledWith("b1", "a1");
  });

  it("removes a variation", async () => {
    render(<LogoVariations brandId="b1" initial={[stacked, icon]} />);

    await userEvent.click(
      screen.getByRole("button", { name: /remove stacked mark/i }),
    );

    expect(removeLogoVariation).toHaveBeenCalledWith("b1", "a1");
  });

  /* The acceptance criterion this feature exists for: a second file must not
     replace the first. */
  it("adds a new variation with the label and background chosen", async () => {
    render(<LogoVariations brandId="b1" initial={[]} />);

    const file = new File(["png"], "horizontal.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("variation-file"), file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    await userEvent.type(
      screen.getByLabelText(/what to call it/i),
      "Horizontal lockup",
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/shape/i),
      "horizontal",
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/background/i),
      "light",
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add variation/i }),
    );

    await waitFor(() => expect(addLogoVariation).toHaveBeenCalled());
    expect(addLogoVariation.mock.calls[0][0]).toMatchObject({
      brandId: "b1",
      fileUrl: "https://cdn.example.test/logos/u1/new.png",
      label: "Horizontal lockup",
      logoVariant: "horizontal",
      logoBackground: "light",
    });
  });

  it("will not add a variation before a file has uploaded", async () => {
    render(<LogoVariations brandId="b1" initial={[]} />);

    expect(
      screen.getByRole("button", { name: /add variation/i }),
    ).toBeDisabled();
  });

  it("says so when the upload fails, and adds nothing", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    render(<LogoVariations brandId="b1" initial={[]} />);

    const file = new File(["png"], "horizontal.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("variation-file"), file);

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(addLogoVariation).not.toHaveBeenCalled();
  });

  it("surfaces a rejected save rather than pretending it worked", async () => {
    addLogoVariation.mockResolvedValue({ ok: false, error: "No access" });
    render(<LogoVariations brandId="b1" initial={[]} />);

    const file = new File(["png"], "x.png", { type: "image/png" });
    await userEvent.upload(screen.getByTestId("variation-file"), file);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await userEvent.click(
      screen.getByRole("button", { name: /add variation/i }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("No access"));
  });
});
