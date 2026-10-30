import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SerializedGeneration } from "@/lib/design/serialize";

const saveBlob = vi.fn();
vi.mock("@/lib/design/png-to-jpeg", () => ({
  saveBlob: (...a: unknown[]) => saveBlob(...a),
}));

import { BRAND, frameRow, frameRows, SET } from "./fixtures";
import { buildSet, type DesignSet } from "./set-model";
import { SetViewer } from "./set-viewer";
import { regenKey } from "./use-frame-set";

function setOf(rows: SerializedGeneration[], frameCount?: number): DesignSet {
  const set = buildSet(BRAND, rows, { frameCount });
  if (!set) throw new Error("no set");
  return set;
}

const onRegenerateFrame = vi.fn();

function renderViewer(
  set: DesignSet = setOf(frameRows(5)),
  props: {
    actingOn?: ReadonlySet<string>;
    frameErrors?: Record<number, string>;
  } = {},
) {
  const view = (p: typeof props) => (
    <SetViewer
      set={set}
      actingOn={p.actingOn ?? new Set()}
      frameErrors={p.frameErrors ?? {}}
      onRegenerateFrame={onRegenerateFrame}
    />
  );
  const utils = render(view(props));
  return { ...utils, update: (p: typeof props) => utils.rerender(view(p)) };
}

const tabs = () => screen.getAllByRole("tab");
const selectedTab = () =>
  tabs().find((t) => t.getAttribute("aria-selected") === "true");
const position = () =>
  screen
    .getAllByRole("status")
    .find((s) => /^Frame \d+ of \d+/.test(s.textContent ?? ""))?.textContent;

beforeEach(() => {
  vi.clearAllMocks();
  onRegenerateFrame.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("SetViewer reads as one carousel", () => {
  it("lists every frame in order with its role", () => {
    renderViewer();
    expect(tabs().map((t) => t.getAttribute("aria-label"))).toEqual([
      "Frame 1 of 5, Hook: The launch",
      "Frame 2 of 5, Point: The fabric",
      "Frame 3 of 5, Point: The price",
      "Frame 4 of 5, Point: The venue",
      "Frame 5 of 5, Action: Book now",
    ]);
    const rail = screen.getByRole("tablist");
    expect(
      tabs().map((t) => within(t).getByText(/Hook|Point|Action/).textContent),
    ).toEqual(["Hook", "Point", "Point", "Point", "Action"]);
    expect(rail).toHaveAccessibleName("Frames of this carousel");
    expect(
      screen.getByRole("region", { name: "carousel, 5 slides" }),
    ).toHaveAttribute("aria-roledescription", "carousel");
  });

  it("opens on the hook and announces where the user is", () => {
    renderViewer();
    expect(selectedTab()).toHaveAccessibleName(/Frame 1 of 5, Hook/);
    expect(position()).toMatch(/^Frame 1 of 5 · Hook/);
    expect(
      screen.getByRole("heading", { name: "The launch" }),
    ).toBeInTheDocument();
  });

  it("names presentation roles as slides", () => {
    const rows = frameRows(3).map((r) => ({
      ...r,
      designType: "Sales presentation",
      width: 1920,
      height: 1080,
    }));
    renderViewer(setOf(rows));
    expect(
      tabs().map((t) => within(t).getByText(/Title|Slide|Close/).textContent),
    ).toEqual(["Title", "Slide", "Close"]);
    expect(
      screen.getByRole("region", { name: "presentation, 3 slides" }),
    ).toBeInTheDocument();
  });

  it("keeps only the frame on show reachable; the rest are inert", () => {
    renderViewer();
    const panel = screen.getByRole("tabpanel");
    const slides = panel.querySelectorAll("[data-frame-index]");
    expect(slides).toHaveLength(5);
    expect(slides[0]).not.toHaveAttribute("aria-hidden");
    expect(slides[1]).toHaveAttribute("aria-hidden", "true");
    expect(within(panel).getAllByRole("img")).toHaveLength(1);
  });
});

describe("moving between frames", () => {
  it("walks the stage with the arrow keys, Home and End", async () => {
    renderViewer();
    const stage = screen.getByRole("tabpanel");
    stage.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(position()).toMatch(/^Frame 2 of 5 · Point/);
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(position()).toMatch(/^Frame 4 of 5/);
    await userEvent.keyboard("{ArrowLeft}");
    expect(position()).toMatch(/^Frame 3 of 5/);
    await userEvent.keyboard("{End}");
    expect(position()).toMatch(/^Frame 5 of 5 · Action/);
    await userEvent.keyboard("{ArrowRight}");
    expect(position()).toMatch(/^Frame 5 of 5/);
    await userEvent.keyboard("{Home}");
    expect(position()).toMatch(/^Frame 1 of 5/);
    await userEvent.keyboard("{ArrowLeft}");
    expect(position()).toMatch(/^Frame 1 of 5/);
  });

  it("walks the rail with the arrow keys, moving focus with the selection", async () => {
    renderViewer();
    tabs()[0]?.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(selectedTab()).toHaveAccessibleName(/Frame 2 of 5/);
    expect(document.activeElement).toBe(tabs()[1]);
    expect(tabs().map((t) => t.tabIndex)).toEqual([-1, 0, -1, -1, -1]);
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(tabs()[4]);
  });

  it("selects the frame whose thumbnail is clicked", async () => {
    renderViewer();
    await userEvent.click(tabs()[2] as HTMLElement);
    expect(position()).toMatch(/^Frame 3 of 5 · Point/);
    expect(screen.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      tabs()[2]?.id,
    );
  });

  it("moves with the previous and next buttons", async () => {
    renderViewer();
    const prev = screen.getByRole("button", { name: "Previous frame" });
    expect(prev).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(screen.getByRole("button", { name: "Next frame" }));
    expect(position()).toMatch(/^Frame 2 of 5/);
  });

  it("turns the page on a sideways swipe, not on a short wobble", () => {
    renderViewer();
    const stage = screen.getByRole("tabpanel");
    const swipe = (from: number, to: number) => {
      fireEvent.pointerDown(stage, {
        clientX: from,
        clientY: 10,
        pointerId: 1,
      });
      fireEvent.pointerMove(stage, { clientX: to, clientY: 12, pointerId: 1 });
      fireEvent.pointerUp(stage, { clientX: to, clientY: 12, pointerId: 1 });
    };
    swipe(300, 100);
    expect(position()).toMatch(/^Frame 2 of 5/);
    swipe(300, 285);
    expect(position()).toMatch(/^Frame 2 of 5/);
    swipe(100, 300);
    expect(position()).toMatch(/^Frame 1 of 5/);
  });
});

describe("regenerating one frame", () => {
  it("regenerates the selected frame with no edits", async () => {
    renderViewer();
    await userEvent.click(tabs()[1] as HTMLElement);
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate frame 2" }),
    );
    expect(onRegenerateFrame).toHaveBeenCalledWith("f1", undefined);
  });

  /* CLAUDE.md: the pending state is keyed to the row, or every frame
     claims to be working. */
  it("shows the wait on that frame only", async () => {
    renderViewer(undefined, { actingOn: new Set([regenKey("f1")]) });
    await userEvent.click(tabs()[1] as HTMLElement);
    const busy = screen.getByRole("button", { name: /Regenerating/ });
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(tabs()[1]).toHaveAccessibleName(/\(regenerating\)/);
    expect(
      within(screen.getByRole("tabpanel")).getByText("Making a new frame…"),
    ).toBeInTheDocument();

    await userEvent.click(tabs()[2] as HTMLElement);
    const idle = screen.getByRole("button", { name: "Regenerate frame 3" });
    expect(idle).not.toHaveAttribute("aria-busy");
    expect(tabs()[2]).not.toHaveAccessibleName(/regenerating/);
  });

  it("holds downloads while any frame regenerates", () => {
    renderViewer(undefined, { actingOn: new Set([regenKey("f3")]) });
    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  });

  it("says on the frame when its regenerate failed", async () => {
    renderViewer(undefined, {
      frameErrors: {
        2: "Regenerating didn't work, so this frame is unchanged.",
      },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(tabs()[2] as HTMLElement);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Regenerating didn't work, so this frame is unchanged.",
    );
  });
});

describe("Edit & regenerate", () => {
  it("prefills the frame's lines and offers no button text off the CTA frame", async () => {
    renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    const form = screen.getByRole("form", { name: "Edit frame 1" });
    expect(within(form).getByLabelText("Headline")).toHaveValue("Headline 1");
    expect(within(form).getByLabelText("Subheadline")).toHaveValue(
      "Subheadline 1",
    );
    expect(within(form).queryByLabelText("Button text")).toBeNull();
    expect(document.activeElement).toBe(
      within(form).getByLabelText("Headline"),
    );
  });

  it("prefills the CTA it is editing on the CTA frame", async () => {
    renderViewer();
    await userEvent.click(tabs()[4] as HTMLElement);
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 5" }),
    );
    expect(screen.getByLabelText("Button text")).toHaveValue("Book a table");
    expect(screen.getByLabelText("Subheadline")).toHaveValue("Subheadline 5");
  });

  it("refuses a frame with no headline before anything is billed", async () => {
    renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    const headline = screen.getByLabelText("Headline");
    await userEvent.clear(headline);
    expect(headline).toHaveAttribute("aria-invalid", "true");
    expect(headline).toHaveAccessibleDescription("A frame needs a headline.");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A frame needs a headline.",
    );
    const submit = screen.getByRole("button", {
      name: "Regenerate with my words",
    });
    expect(submit).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(submit);
    await userEvent.type(headline, "{Enter}");
    expect(onRegenerateFrame).not.toHaveBeenCalled();

    await userEvent.type(headline, "New hook");
    expect(screen.queryByRole("alert")).toBeNull();
    await userEvent.click(submit);
    expect(onRegenerateFrame).toHaveBeenCalledWith("f0", {
      headline: "New hook",
    });
  });

  it("lets the user clear a subheadline, which removes the line", async () => {
    renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    await userEvent.clear(screen.getByLabelText("Subheadline"));
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate with my words" }),
    );
    expect(onRegenerateFrame).toHaveBeenCalledWith("f0", { subheadline: "" });
  });

  /* H9: the user's words are drawn as typed. The form sends exactly what
     was typed in the fields that changed, untrimmed, and nothing else. */
  it("submits exactly the lines that changed, as typed", async () => {
    renderViewer();
    await userEvent.click(tabs()[4] as HTMLElement);
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 5" }),
    );
    const submit = screen.getByRole("button", {
      name: "Regenerate with my words",
    });
    expect(submit).toHaveAttribute("aria-disabled", "true");

    const headline = screen.getByLabelText("Headline");
    await userEvent.clear(headline);
    await userEvent.type(headline, "  Book by FRIDAY!  ");
    const cta = screen.getByLabelText("Button text");
    await userEvent.clear(cta);
    await userEvent.type(cta, "Reserve");
    await userEvent.click(submit);

    expect(onRegenerateFrame).toHaveBeenCalledWith("f4", {
      headline: "  Book by FRIDAY!  ",
      cta: "Reserve",
    });
  });

  it("closes once the new frame is in and hands focus back", async () => {
    onRegenerateFrame.mockResolvedValue(frameRow(0, { id: "f0-new" }));
    renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    await userEvent.type(screen.getByLabelText("Subheadline"), "Hand-woven");
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate with my words" }),
    );
    expect(screen.queryByRole("form")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
  });

  it("stays open with the words kept when the regenerate fails", async () => {
    renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    await userEvent.clear(screen.getByLabelText("Subheadline"));
    await userEvent.type(screen.getByLabelText("Subheadline"), "Hand-woven");
    await userEvent.click(
      screen.getByRole("button", { name: "Regenerate with my words" }),
    );
    expect(screen.getByLabelText("Subheadline")).toHaveValue("Hand-woven");
  });

  it("shows the submit as working while that frame regenerates", async () => {
    const { update } = renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    await userEvent.type(screen.getByLabelText("Subheadline"), "x");
    update({ actingOn: new Set([regenKey("f0")]) });
    const submit = screen.getByRole("button", { name: /Regenerating…/ });
    expect(submit).toHaveAttribute("aria-busy", "true");
  });

  it("closes when the user moves to another frame", async () => {
    renderViewer();
    await userEvent.click(
      screen.getByRole("button", { name: "Edit & regenerate frame 1" }),
    );
    await userEvent.click(tabs()[1] as HTMLElement);
    expect(screen.queryByRole("form")).toBeNull();
  });
});

describe("frames that are not ready", () => {
  it("states a failed frame and puts its retry on the frame itself", async () => {
    const rows = frameRows(5);
    rows[2] = frameRow(2, { status: "failed", url: null });
    renderViewer(setOf(rows));
    expect(tabs()[2]).toHaveAccessibleName(/\(didn't render\)/);
    expect(tabs()[2]).toHaveAttribute("data-state", "failed");
    await userEvent.click(tabs()[2] as HTMLElement);
    const stage = screen.getByRole("tabpanel");
    expect(
      within(stage).getByText("This frame didn't render."),
    ).toBeInTheDocument();
    const retry = within(stage).getByRole("button", { name: "Retry frame 3" });
    expect(screen.getAllByRole("button", { name: /Retry frame/ })).toEqual([
      retry,
    ]);
    expect(screen.queryByRole("link", { name: /Download this frame/ })).toBe(
      null,
    );
    await userEvent.click(retry);
    expect(onRegenerateFrame).toHaveBeenCalledWith("f2", undefined);
  });

  it("swaps a retrying frame's button for the wait on that frame", async () => {
    const rows = frameRows(5);
    rows[2] = frameRow(2, { status: "failed", url: null });
    renderViewer(setOf(rows), { actingOn: new Set([regenKey("f2")]) });
    await userEvent.click(tabs()[2] as HTMLElement);
    const stage = screen.getByRole("tabpanel");
    expect(within(stage).queryByRole("button")).toBeNull();
    expect(within(stage).getByText("Making a new frame…")).toBeInTheDocument();
  });

  it("draws a frame still rendering as a placeholder with nothing to act on", async () => {
    const rows = frameRows(5);
    rows[1] = frameRow(1, { status: "pending", url: null });
    renderViewer(setOf(rows));
    await userEvent.click(tabs()[1] as HTMLElement);
    const panel = screen.getByRole("tabpanel");
    expect(
      within(panel).getByText("This frame is still rendering…"),
    ).toBeInTheDocument();
    expect(panel.querySelector("[data-slot=skeleton]")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit & regenerate frame 2" }),
    ).toBeDisabled();
  });

  it("says a frame the job never made is missing, with no retry to press", async () => {
    renderViewer(setOf([frameRow(0), frameRow(1), frameRow(2)], 5));
    await userEvent.click(tabs()[3] as HTMLElement);
    expect(screen.getByText(/never got to this frame/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Regenerate frame 4/ }),
    ).toBeNull();
  });

  it("shows a skeleton until a frame's picture has loaded", async () => {
    renderViewer();
    const panel = screen.getByRole("tabpanel");
    const first = panel.querySelector('[data-frame-index="0"]') as HTMLElement;
    expect(first.querySelector("[data-slot=skeleton]")).not.toBeNull();
    expect(within(first).getByRole("status")).toHaveTextContent(
      "Loading this frame…",
    );
    fireEvent.load(within(first).getByRole("img"));
    await waitFor(() =>
      expect(first.querySelector("[data-slot=skeleton]")).toBeNull(),
    );
  });

  /* CLAUDE.md: a status region carries real text. A thumbnail has no room
     for any, so it is a plain placeholder and the stage does the telling. */
  it("gives no thumbnail an empty status region while it loads", () => {
    renderViewer();
    const rail = screen.getByRole("tablist");
    expect(rail.querySelector("[data-slot=skeleton]")).not.toBeNull();
    expect(within(rail).queryAllByRole("status")).toEqual([]);
    for (const status of screen.getAllByRole("status")) {
      expect(status.textContent?.trim()).not.toBe("");
    }
  });

  it("says the preview is unavailable when a frame's picture fails", async () => {
    renderViewer();
    const panel = screen.getByRole("tabpanel");
    fireEvent.error(within(panel).getByRole("img"));
    expect(
      await within(panel).findByText("Preview unavailable"),
    ).toBeInTheDocument();
  });
});

describe("downloads", () => {
  function stubFetch(response: () => Promise<Response>) {
    const fetchMock = vi.fn(response);
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it.each([
    ["Download ZIP", "zip", "Packing ZIP…"],
    ["Download PDF", "pdf", "Making PDF…"],
  ])(
    "%s fetches the set route and says it is working",
    async (name, format, busy) => {
      let finish: (r: Response) => void = () => {};
      const fetchMock = stubFetch(
        () => new Promise<Response>((resolve) => (finish = resolve)),
      );
      renderViewer();
      await userEvent.click(screen.getByRole("button", { name }));
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/design/sets/${SET}/download?brandId=${BRAND}&format=${format}`,
      );
      expect(screen.getByRole("button", { name: busy })).toHaveAttribute(
        "aria-busy",
        "true",
      );
      await act(async () => {
        finish(
          new Response("bytes", {
            headers: {
              "content-disposition": `attachment; filename="launch.${format}"`,
            },
          }),
        );
      });
      expect(saveBlob).toHaveBeenCalledWith(
        expect.any(Blob),
        `launch.${format}`,
      );
      expect(screen.getByRole("button", { name })).not.toHaveAttribute(
        "aria-busy",
      );
    },
  );

  it("offers the selected frame on its own through the design download route", async () => {
    renderViewer();
    await userEvent.click(tabs()[3] as HTMLElement);
    const link = screen.getByRole("link", { name: /Download this frame/ });
    expect(link).toHaveAttribute("href", "/api/design/generations/f3/download");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("offers no single-frame download while that frame regenerates", () => {
    renderViewer(undefined, { actingOn: new Set([regenKey("f0")]) });
    expect(screen.queryByRole("link", { name: /Download this frame/ })).toBe(
      null,
    );
  });

  it("says when the file could not be made", async () => {
    stubFetch(async () => new Response("{}", { status: 500 }));
    renderViewer();
    await userEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The PDF couldn't be made. Try again.",
    );
    expect(saveBlob).not.toHaveBeenCalled();
  });
});
