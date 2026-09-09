import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesignStudioClient } from "./design-studio-client";

const generate = vi.fn();
const reset = vi.fn();
const design = {
  pending: false,
  progressLabel: null as string | null,
  error: null as string | null,
  generations: [] as unknown[],
  generate,
  reset,
};

vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => design,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./context-picker", () => ({
  ContextPicker: () => null,
  toAttachmentRefs: () => [],
}));

function generation(overrides = {}) {
  return {
    id: "g1",
    url: "https://r2.example/generated/g1.png",
    renderer: "composite" as const,
    headline: "Launch week",
    designType: "Instagram post",
    width: 1080,
    height: 1350,
    ...overrides,
  } as never;
}

function renderStudio(initial: unknown[] = [generation()]) {
  return render(
    <DesignStudioClient
      brandId="b1"
      brandName="Lagos Loom"
      initialGenerations={initial as never}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  design.pending = false;
  design.error = null;
  design.generations = [];
});

/* The ticket in one sentence: clicking a card opens a preview with a Download
   button. Both halves were tested in isolation and the wiring was not, so the
   card handler could be gutted with everything green. */
describe("DesignStudioClient history grid", () => {
  it("opens the preview for the card that was clicked", async () => {
    renderStudio([generation(), generation({ id: "g2", headline: "Second" })]);

    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Preview Second" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/api/design/generations/g2/download",
    );
  });

  /* A card from the history is not the run that is in flight: showing the
     generation results there would preview a different design than the one
     the user clicked. */
  it("shows only the clicked design, not the last generation run", async () => {
    design.generations = [generation({ id: "fresh", headline: "Fresh run" })];
    renderStudio([generation({ id: "old", headline: "Older design" })]);

    await userEvent.click(
      screen.getByRole("button", { name: "Preview Older design" }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/api/design/generations/old/download",
    );
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
  });

  /* Generating opens the same modal, and there Regenerate makes sense. */
  it("offers Regenerate for a run it started", async () => {
    renderStudio([]);
    await userEvent.click(
      screen.getByRole("button", { name: /generate design/i }),
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(generate).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /regenerate/i }),
    ).toBeInTheDocument();
  });

  /* reset() clears the run's generations and the grid is now the only route
     back to a preview, so without a refresh the design just made is missing
     from it until a reload. */
  it("refreshes the grid after a run that produced a design", async () => {
    design.generations = [generation({ id: "fresh" })];
    renderStudio([]);
    await userEvent.click(
      screen.getByRole("button", { name: /generate design/i }),
    );
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    expect(reset).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
  });

  /* Refetching before the job has written anything achieves nothing — the
     design is still missing from the grid either way. */
  it("does not refresh when closed while the run is still going", async () => {
    renderStudio([]);
    await userEvent.click(
      screen.getByRole("button", { name: /generate design/i }),
    );
    await screen.findByRole("dialog");

    // The job is still running when the user gives up and closes.
    design.pending = true;
    await userEvent.keyboard("{Escape}");

    expect(refresh).not.toHaveBeenCalled();
  });

  /* Refetching 24 rows and re-signing their URLs to close a preview that
     changed nothing is pure cost. */
  it("does not refresh after merely previewing an existing card", async () => {
    renderStudio([generation({ id: "old", headline: "Older design" })]);
    await userEvent.click(
      screen.getByRole("button", { name: "Preview Older design" }),
    );
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");

    expect(refresh).not.toHaveBeenCalled();
  });

  it("is a grid of buttons, never links to the raw file", () => {
    renderStudio();
    expect(screen.queryByRole("link", { name: /preview/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /preview/i }),
    ).toBeInTheDocument();
  });
});
