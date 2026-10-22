import { act, render } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TOAST_TEXT_TOKENS, Toaster } from "./sonner";

/* jsdom has no matchMedia; Sonner reads it for the system theme. */
beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }));
});

describe("Toaster", () => {
  it("paints each rich toast type's text with the app's status token", async () => {
    render(<Toaster richColors />);
    act(() => {
      toast.success("Sent");
    });
    const toaster = await vi.waitFor(() => {
      const el = document.querySelector<HTMLElement>("[data-sonner-toaster]");
      if (!el) throw new Error("no toaster yet");
      return el;
    });
    for (const [type, token] of Object.entries(TOAST_TEXT_TOKENS)) {
      expect(toaster.style.getPropertyValue(`--${type}-text`)).toBe(
        `var(${token})`,
      );
    }
  });
});
