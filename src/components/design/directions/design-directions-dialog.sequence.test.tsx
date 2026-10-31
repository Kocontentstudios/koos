import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BRAND,
  frameRows,
  plannedOutline,
  SET,
} from "@/components/design/sequence/fixtures";
import { buildSet } from "@/components/design/sequence/set-model";
import {
  FRAME_STILL_RUNNING,
  regenKey,
} from "@/components/design/sequence/use-frame-set";
import type {
  DesignGenerationState,
  LiveDesignGeneration,
} from "@/components/design/use-design-generation";
import { sequenceKindOf } from "@/lib/design/sequence/contract";
import { KoImageryProvider } from "./ko-imagery-context";
import { MultiFrameProvider } from "./multi-frame-context";

vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function runState(
  overrides: Partial<LiveDesignGeneration> = {},
): LiveDesignGeneration {
  return {
    generate: vi.fn(async () => []),
    retry: vi.fn(async () => {}),
    pending: false,
    progressLabel: null,
    stage: null,
    progress: null,
    jobStage: null,
    error: null,
    stillRunning: false,
    partial: null,
    failedCount: 0,
    failedIds: [],
    generations: [],
    set: null,
    sequenceProgress: null,
    regenerateFrame: vi.fn(async () => null),
    keepWaitingOnFrame: vi.fn(async () => null),
    frameActions: new Set(),
    frameErrors: {},
    framesStillRunning: new Set(),
    posting: false,
    reset: vi.fn(),
    ...overrides,
  };
}

let slotRun: DesignGenerationState;
vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => slotRun,
}));

import { DesignDirectionsDialog } from "./design-directions-dialog";

/** FEATURE_KO_IMAGERY on, FEATURE_MULTI_FRAME as given, the way the pages
 *  hand both down. */
function flags(multiFrame: boolean) {
  return {
    wrapper: ({ children }: { children: React.ReactNode }) => (
      <KoImageryProvider enabled>
        <MultiFrameProvider enabled={multiFrame}>{children}</MultiFrameProvider>
      </KoImageryProvider>
    ),
  };
}

async function openWith(
  design: DesignGenerationState,
  {
    designType = "Instagram carousel",
    multiFrame = true,
    onRunStart = vi.fn(),
  } = {},
) {
  render(
    <DesignDirectionsDialog
      open
      onOpenChange={vi.fn()}
      entry="brief"
      args={{ brandId: BRAND, briefId: "brief-1" }}
      design={design}
      ticketContext={{ briefId: "brief-1", designType }}
      onRunStart={onRunStart}
    />,
    flags(multiFrame),
  );
  await userEvent.click(
    screen.getByRole("button", { name: /let ko create the imagery/i }),
  );
  const kind = multiFrame ? sequenceKindOf(designType) : null;
  if (kind) await approveOutline();
}

/** A set stops at its outline; this approves it as planned. */
async function approveOutline() {
  await screen.findByRole("list", { name: /^Outline/ });
  await userEvent.click(
    screen.getByRole("button", { name: /^Generate \d+ slides · \d+ units$/ }),
  );
}

const outlineFetch = vi.fn(async (url: string, _init?: RequestInit) =>
  url === "/api/design/outline"
    ? Response.json({ outline: plannedOutline(5) })
    : Response.json({ error: "unexpected" }, { status: 500 }),
);

beforeEach(() => {
  vi.clearAllMocks();
  slotRun = runState();
  vi.stubGlobal("fetch", outlineFetch);
});
afterEach(() => vi.unstubAllGlobals());

/* H6: the run is told a kind only when FEATURE_MULTI_FRAME is on, so a
   flag-off carousel brief and every single design start exactly as before:
   one argument, no options. */
describe("what the dialog tells the run", () => {
  it("tells a run a carousel brief expects a carousel when sets are on", async () => {
    const design = runState();
    await openWith(design);
    expect(design.generate).toHaveBeenCalledWith(
      {
        brandId: BRAND,
        briefId: "brief-1",
        image: { source: "ko" },
        approvedOutline: {
          kind: "carousel",
          points: plannedOutline(5).points.map(
            ({ id, role, title, point, source }) => ({
              id,
              role,
              title,
              point,
              source,
            }),
          ),
        },
      },
      { sequenceKind: "carousel" },
    );
  });

  it("tells a presentation brief's run to expect a presentation", async () => {
    const design = runState();
    await openWith(design, { designType: "Presentation" });
    expect(vi.mocked(design.generate).mock.calls[0]?.[1]).toEqual({
      sequenceKind: "presentation",
    });
  });

  it("tells a flag-off carousel brief's run nothing", async () => {
    const design = runState();
    await openWith(design, { multiFrame: false });
    expect(vi.mocked(design.generate).mock.calls[0]).toEqual([
      { brandId: BRAND, briefId: "brief-1", image: { source: "ko" } },
    ]);
  });

  /* O7: flag off, the outline step is never shown and its route never
     asked. */
  it("shows no outline step and asks no outline route with the flag off", async () => {
    await openWith(runState(), { multiFrame: false });
    expect(screen.queryByRole("list", { name: /^Outline/ })).toBeNull();
    expect(outlineFetch).not.toHaveBeenCalled();
  });

  it("shows no outline step for a single design, flag on", async () => {
    const design = runState();
    await openWith(design, { designType: "Instagram post" });
    expect(outlineFetch).not.toHaveBeenCalled();
    expect(design.generate).toHaveBeenCalledTimes(1);
  });

  it("tells a single design's run nothing, sets on or off", async () => {
    const design = runState();
    await openWith(design, { designType: "Instagram post" });
    expect(vi.mocked(design.generate).mock.calls[0]).toHaveLength(1);
  });
});

/* KOOS-AI-002: a carousel or presentation run is one set of frames, shown in
   the set viewer from its first progress report to its last regenerate. */
describe("DesignDirectionsDialog with a set of frames", () => {
  const frames = frameRows(5);
  const set = buildSet(BRAND, frames, { setId: SET, frameCount: 5 });

  it("says it is planning before the job has reported its count", async () => {
    await openWith(
      runState({
        pending: true,
        stage: "starting",
        sequenceProgress: {
          kind: "carousel",
          frameCount: null,
          phase: "plan",
          done: 0,
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Making your carousel" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Planning your carousel…",
    );
    expect(document.querySelectorAll("[data-tile]")).toHaveLength(0);
  });

  it("counts frames as they render, one tile per frame", async () => {
    await openWith(
      runState({
        pending: true,
        stage: "running",
        sequenceProgress: {
          kind: "carousel",
          frameCount: 5,
          phase: "render",
          done: 2,
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Making your 5-slide carousel" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Frame 3 of 5…");
    const tiles = [...document.querySelectorAll("[data-tile]")].map((t) =>
      t.getAttribute("data-tile"),
    );
    expect(tiles).toEqual(["done", "done", "current", "waiting", "waiting"]);
  });

  /* W1/L7: KO imagery spans several slices; nothing promises seconds. */
  it("says a KO-imagery set can take minutes, and promises no time otherwise", async () => {
    const waiting = runState({
      pending: true,
      stage: "running",
      sequenceProgress: {
        kind: "carousel",
        frameCount: 5,
        phase: "render",
        done: 1,
      },
    });
    await openWith(waiting);
    expect(
      screen.getByText(/this can take several minutes/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/few seconds/i)).toBeNull();
    expect(
      screen.getByText(/Design Studio picks it up and shows each frame/),
    ).toBeInTheDocument();
  });

  it("names the slides without a kind when nothing named it", async () => {
    await openWith(
      runState({
        pending: true,
        stage: "running",
        sequenceProgress: {
          kind: null,
          frameCount: 6,
          phase: "plan",
          done: 0,
        },
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Making your 6 slides" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Planning your slides…",
    );
  });

  /* H7/H8: a set that outlives the poll has not failed. The way on watches
     the same job; it never starts (and bills) a second one. */
  it("offers to keep waiting on a set the client stopped watching", async () => {
    const design = runState({
      error: "Your carousel is still being made.",
      stillRunning: true,
    });
    await openWith(design);
    vi.mocked(design.generate).mockClear();
    expect(
      screen.getByRole("heading", { name: "Still working on it" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Keep waiting" }));
    expect(design.retry).toHaveBeenCalledTimes(1);
    expect(design.generate).not.toHaveBeenCalled();
  });

  it("keeps the directions progress for a run that reports no sequence", async () => {
    await openWith(runState({ pending: true, stage: "running" }), {
      designType: "Instagram post",
    });
    expect(
      screen.getByRole("heading", { name: "Creating two directions" }),
    ).toBeInTheDocument();
  });

  it("opens the set viewer, not the legacy preview, once the set is in", async () => {
    await openWith(runState({ generations: frames, set }));
    expect(
      screen.getByRole("heading", { name: "Your 5-slide carousel" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(5);
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeVisible();
  });

  it("regenerates one frame through the run's hook and counts it as a run", async () => {
    const regenerateFrame = vi.fn(async () => null);
    const onRunStart = vi.fn();
    await openWith(runState({ generations: frames, set, regenerateFrame }), {
      onRunStart,
    });
    onRunStart.mockClear();
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate frame 1" }),
    );
    expect(regenerateFrame).toHaveBeenCalledWith("f0", undefined);
    expect(onRunStart).toHaveBeenCalledTimes(1);
  });

  it("holds Start over while a frame regenerates", async () => {
    await openWith(
      runState({
        generations: frames,
        set,
        frameActions: new Set([regenKey("f2")]),
      }),
    );
    expect(screen.getByRole("button", { name: "Start over" })).toBeDisabled();
  });

  /* M6: a frame's job that outlived the poll is waited on, not re-billed. */
  it("keeps waiting on a frame whose job may still deliver", async () => {
    const keepWaitingOnFrame = vi.fn(async () => null);
    const regenerateFrame = vi.fn(async () => null);
    await openWith(
      runState({
        generations: frames,
        set,
        keepWaitingOnFrame,
        regenerateFrame,
        framesStillRunning: new Set([0]),
        frameErrors: { 0: FRAME_STILL_RUNNING },
      }),
    );
    expect(document.querySelector("[data-frame-waiting]")).toHaveTextContent(
      FRAME_STILL_RUNNING,
    );
    expect(screen.queryByText(/didn't work/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Regenerate frame 1" }),
    ).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Keep waiting" }));
    expect(keepWaitingOnFrame).toHaveBeenCalledWith(0);
    expect(regenerateFrame).not.toHaveBeenCalled();
  });
});

/* O3/O6: the outline is the step between the image and the run. Nothing is
   generated until it is approved, and its edits survive a change of image. */
describe("the outline step in the dialog", () => {
  it("plans the outline after the image is chosen and generates nothing yet", async () => {
    const design = runState();
    render(
      <DesignDirectionsDialog
        open
        onOpenChange={vi.fn()}
        entry="brief"
        args={{ brandId: BRAND, briefId: "brief-1" }}
        design={design}
        ticketContext={{ briefId: "brief-1", designType: "Instagram carousel" }}
      />,
      flags(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    expect(
      screen.getByRole("heading", { name: "Plan your carousel" }),
    ).toBeInTheDocument();
    await screen.findByRole("list", { name: /^Outline/ });
    expect(outlineFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(outlineFetch.mock.calls[0]?.[1]?.body))).toEqual({
      brandId: BRAND,
      briefId: "brief-1",
    });
    expect(design.generate).not.toHaveBeenCalled();
  });

  it("sends the edited outline, and counts the approval as a run", async () => {
    const design = runState();
    const onRunStart = vi.fn();
    render(
      <DesignDirectionsDialog
        open
        onOpenChange={vi.fn()}
        entry="brief"
        args={{ brandId: BRAND, briefId: "brief-1" }}
        design={design}
        ticketContext={{ briefId: "brief-1", designType: "Instagram carousel" }}
        onRunStart={onRunStart}
      />,
      flags(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    await screen.findByRole("list", { name: /^Outline/ });
    expect(onRunStart).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "Delete slide 3, Who it's for" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Generate 4 slides · 4 units" }),
    );
    expect(onRunStart).toHaveBeenCalledTimes(1);
    const sent = vi.mocked(design.generate).mock.calls[0]?.[0];
    expect(sent?.approvedOutline?.points.map((p) => p.id)).toEqual([
      "p1",
      "p2",
      "p4",
      "p5",
    ]);
  });

  it("keeps the outline's edits when the user goes back to change the image", async () => {
    render(
      <DesignDirectionsDialog
        open
        onOpenChange={vi.fn()}
        entry="brief"
        args={{ brandId: BRAND, briefId: "brief-1" }}
        design={runState()}
        ticketContext={{ briefId: "brief-1", designType: "Instagram carousel" }}
      />,
      flags(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    await screen.findByRole("list", { name: /^Outline/ });
    await userEvent.click(
      screen.getByRole("button", { name: "Delete slide 3, Who it's for" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    expect(
      screen.getByRole("button", { name: "Generate 4 slides · 4 units" }),
    ).toBeInTheDocument();
    expect(outlineFetch).toHaveBeenCalledTimes(1);
  });

  it("holds the outline on screen, with the button busy, while the server takes the run", async () => {
    await openWith(
      runState({ pending: true, posting: true, stage: "starting" }),
    );
    expect(screen.getByRole("list", { name: /^Outline/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Starting…" })).toHaveAttribute(
      "aria-busy",
      "true",
    );
  });

  it("offers the way back to the outline when its run fails", async () => {
    const design = runState({
      error: "Invalid outline. Slide 2: The title is empty.",
    });
    await openWith(design);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Slide 2: The title is empty.");
    await userEvent.click(
      within(alert).getByRole("button", { name: "Edit outline" }),
    );
    expect(design.reset).toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Generate 5 slides · 5 units" }),
    ).toBeInTheDocument();
    expect(outlineFetch).toHaveBeenCalledTimes(1);
  });

  async function clickBeside() {
    const backdrop = document.querySelector('[data-slot="dialog-overlay"]');
    if (!backdrop) throw new Error("no backdrop");
    await userEvent.click(backdrop);
  }

  async function openOutline(onOpenChange: () => void) {
    render(
      <DesignDirectionsDialog
        open
        onOpenChange={onOpenChange}
        entry="brief"
        args={{ brandId: BRAND, briefId: "brief-1" }}
        design={runState()}
        ticketContext={{ briefId: "brief-1", designType: "Instagram carousel" }}
      />,
      flags(true),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /let ko create the imagery/i }),
    );
    await screen.findByRole("list", { name: /^Outline/ });
  }

  it("closes on a click beside it while the outline is untouched", async () => {
    const onOpenChange = vi.fn();
    await openOutline(onOpenChange);
    await clickBeside();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not throw edits away on a click beside it", async () => {
    const onOpenChange = vi.fn();
    await openOutline(onOpenChange);
    await userEvent.click(
      screen.getByRole("button", { name: "Delete slide 3, Who it's for" }),
    );
    await clickBeside();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
