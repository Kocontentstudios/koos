import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_STATE } from "./brand-form-state";
import { SuggestButton } from "./suggest-button";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

afterEach(() => vi.restoreAllMocks());

describe("SuggestButton", () => {
  it("labels 'Suggest' when the field is empty and applies the API result", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ suggestion: "AI-written overview." }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onApply = vi.fn();

    render(
      <SuggestButton
        field="overview"
        state={{ ...DEFAULT_STATE, overview: "" }}
        onApply={onApply}
      />,
    );

    const btn = screen.getByRole("button", { name: /suggest/i });
    fireEvent.click(btn);

    await waitFor(() =>
      expect(onApply).toHaveBeenCalledWith("AI-written overview."),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/brand/suggest",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("labels 'Enhance' when the field already has text", () => {
    render(
      <SuggestButton
        field="overview"
        state={{ ...DEFAULT_STATE, overview: "existing draft" }}
        onApply={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: /enhance/i }),
    ).toBeInTheDocument();
  });
});
