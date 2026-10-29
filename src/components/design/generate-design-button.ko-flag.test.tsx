import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withKoImagery } from "@/lib/testing/ko-imagery";

vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { GenerateDesignButton } from "./generate-design-button";

/* The real button, dialog and generation hook, with only the network faked:
   what leaves the browser is what the server sees. */
const bodies: unknown[] = [];

beforeEach(() => {
  bodies.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (url === "/api/design/generate") {
        return Response.json({ jobId: "job-1" }, { status: 202 });
      }
      return Response.json({
        status: "running",
        result: null,
        error: null,
        progress: { done: 0, total: 2, label: "Writing", stage: "brief" },
      });
    }),
  );
});

afterEach(() => vi.unstubAllGlobals());

const generateBodies = () =>
  bodies.filter(
    (b): b is { image?: { source: string } } =>
      typeof b === "object" && b !== null && "brandId" in b,
  );

async function openChoice() {
  await userEvent.click(
    screen.getByRole("button", { name: /generate design/i }),
  );
  return screen.findByRole("dialog");
}

describe("GenerateDesignButton and FEATURE_KO_IMAGERY", () => {
  it.each([
    ["no provider (a page that forgot the flag)", undefined],
    ["the flag off", withKoImagery(false)],
  ])(
    "with %s, sends a text-led request and never a KO one",
    async (_, options) => {
      render(<GenerateDesignButton brandId="b1" />, options);
      const dialog = await openChoice();
      expect(within(dialog).queryByText(/let ko create/i)).toBeNull();

      await userEvent.click(
        within(dialog).getByRole("button", {
          name: /design without an image/i,
        }),
      );
      await waitFor(() => expect(generateBodies()).toHaveLength(1));
      expect(generateBodies()[0].image).toEqual({ source: "none" });
      expect(JSON.stringify(bodies)).not.toContain('"ko"');
    },
  );

  it("with the flag on, offers KO imagery and sends it as chosen", async () => {
    render(<GenerateDesignButton brandId="b1" />, withKoImagery(true));
    const dialog = await openChoice();
    expect(
      within(dialog).queryByRole("button", {
        name: /design without an image/i,
      }),
    ).toBeNull();

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /let ko create the imagery/i,
      }),
    );
    await waitFor(() => expect(generateBodies()).toHaveLength(1));
    expect(generateBodies()[0].image).toEqual({ source: "ko" });
  });
});
