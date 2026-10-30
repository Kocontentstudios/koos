import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  BRAND,
  frameRow,
  frameRows,
  SET,
  singleRow,
} from "@/components/design/sequence/fixtures";
import {
  rememberSetJob,
  setJobsFor,
} from "@/components/design/sequence/set-jobs";
import { SET_WATCH_INTERVAL_MS } from "@/components/design/sequence/use-set-watch";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { withKoImagery } from "@/lib/testing/ko-imagery";
import { DesignStudioClient } from "./design-studio-client";

const design = {
  pending: false,
  progressLabel: null,
  stage: null,
  progress: null,
  jobStage: null,
  error: null,
  partial: null,
  failedCount: 0,
  failedIds: [] as string[],
  generations: [] as SerializedGeneration[],
  generate: vi.fn(async () => []),
  retry: vi.fn(),
  reset: vi.fn(),
};

vi.mock("@/components/design/use-design-generation", () => ({
  useDesignGeneration: () => design,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/analytics/posthog-client", () => ({ captureEvent: vi.fn() }));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("./context-picker", () => ({
  ContextPicker: () => null,
  toAttachmentRefs: () => [],
}));

function renderStudio(initial: SerializedGeneration[]) {
  return render(
    <DesignStudioClient
      brandId={BRAND}
      brandName="Lagos Loom"
      initialGenerations={initial}
    />,
    withKoImagery(true),
  );
}

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

const justNow = () => new Date().toISOString();

/** Five frames, `pendingFrom` onward still pending, all made just now. */
function buildingSet(pendingFrom: number): SerializedGeneration[] {
  return frameRows(5).map((row, i) =>
    i >= pendingFrom
      ? { ...row, status: "pending", url: null, createdAt: justNow() }
      : { ...row, createdAt: justNow() },
  ) as SerializedGeneration[];
}

let fetchMock: Mock<(url: string) => Promise<Response>>;
let jobReply: () => Response;
let rowsOnServer: SerializedGeneration[];
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  rowsOnServer = [];
  jobReply = () =>
    respond({
      status: "running",
      result: null,
      error: null,
      progress: { stage: "render", done: 3, total: 5, label: "x" },
    });
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/jobs/")) return jobReply();
    const ids = new URL(url, "http://x").searchParams.get("ids")?.split(",");
    return respond({
      generations: rowsOnServer.filter((r) => ids?.includes(r.id)),
    });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const cards = () =>
  screen
    .getAllByRole("button")
    .filter((b) => /^(Preview|Open)/.test(b.getAttribute("aria-label") ?? ""));

/* KOOS-AI-002: a carousel is one thing in the history, not five designs. */
describe("DesignStudioClient history grid with sets", () => {
  const frames = frameRows(5);

  it("shows a set as one card with its slide count, and singles as before", () => {
    renderStudio([
      singleRow("s1", { headline: "Older post" }),
      ...frames,
      singleRow("s2", { headline: "Newer post" }),
    ]);
    expect(cards().map((c) => c.getAttribute("aria-label"))).toEqual([
      "Preview Older post",
      "Open carousel, 5 slides: The launch",
      "Preview Newer post",
    ]);
    const setCard = screen.getByRole("button", { name: /^Open carousel/ });
    expect(within(setCard).getByText("5 slides")).toBeInTheDocument();
    expect(setCard.querySelector("img")).toHaveAttribute(
      "src",
      expect.stringContaining("f0.png"),
    );
  });

  it("opens the set viewer for a set card", async () => {
    renderStudio(frames);
    await userEvent.click(
      screen.getByRole("button", { name: /^Open carousel/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: "Your 5-slide carousel" }),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByRole("tab")).toHaveLength(5);
  });

  it("does not refresh after only looking at a set", async () => {
    renderStudio(frames);
    await userEvent.click(
      screen.getByRole("button", { name: /^Open carousel/ }),
    );
    await screen.findByRole("dialog");
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says on the card when a frame failed", () => {
    const withFailure = [...frames];
    withFailure[2] = frameRow(2, { status: "failed", url: null });
    renderStudio(withFailure);
    expect(
      screen.getByRole("button", {
        name: "Open carousel, 5 slides: The launch. 1 didn't render",
      }),
    ).toBeInTheDocument();
  });

  it("asks the network for nothing while there is nothing to watch", async () => {
    renderStudio([...frames, singleRow("s1")]);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/* H11: the server writes every frame row as pending up front, and a set
   resumes past its 300s slice only while its job is polled. A set that is
   mid-run when the grid loads must keep moving, and one that stopped must
   say so, not show skeletons forever. */
describe("a set still being made when Design Studio opens", () => {
  it("polls the set's job, which also resumes it, and swaps frames in as they land", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const initial = buildingSet(3);
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set" });
    rowsOnServer = initial;
    renderStudio(initial);
    expect(
      screen.getByRole("button", {
        name: "Open carousel, 5 slides: The launch. Still being made, 3 of 5 ready",
      }),
    ).toBeInTheDocument();
    await waitFor(() => expect(urls()).toContain("/api/jobs/job-9"));
    expect(urls()).toContain(
      `/api/design/generations?brandId=${BRAND}&ids=f3,f4`,
    );

    rowsOnServer = initial.map((row, i) =>
      i === 3
        ? { ...row, status: "succeeded", url: "https://cdn.example/f3.png" }
        : row,
    ) as SerializedGeneration[];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Still being made, 4 of 5 ready/ }),
      ).toBeInTheDocument(),
    );
  });

  it("announces where the set is in the open viewer and keeps it current", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const initial = buildingSet(3);
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set" });
    rowsOnServer = initial;
    renderStudio(initial);
    await userEvent.click(
      screen.getByRole("button", { name: /^Open carousel/ }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/^Frame 4 of 5… 3 of 5 ready/),
    ).toHaveAttribute("role", "status");

    rowsOnServer = initial.map((row) => ({
      ...row,
      status: "succeeded",
      url: `https://cdn.example/${row.id}.png`,
    })) as SerializedGeneration[];
    jobReply = () =>
      respond({
        status: "succeeded",
        error: null,
        result: {
          kind: "sequence",
          setId: SET,
          sequenceKind: "carousel",
          frameCount: 5,
          generationIds: ["f0", "f1", "f2", "f3", "f4"],
          failed: [],
          imageSource: "none",
        },
      });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS);
    });
    await waitFor(() =>
      expect(within(dialog).queryByText(/^Frame \d of 5…/)).toBeNull(),
    );
    expect(setJobsFor(BRAND)).toEqual([]);
  });

  it("turns frames still pending into failed frames with a retry when the job failed", async () => {
    const initial = buildingSet(3);
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set" });
    rowsOnServer = initial;
    jobReply = () =>
      respond({ status: "failed", result: null, error: "Stalled." });
    renderStudio(initial);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Open carousel, 5 slides: The launch. 2 didn't render",
        }),
      ).toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /^Open carousel/ }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("tab", { name: /^Frame 4 of 5/ }),
    );
    /* The stage draws frames 4 and 5 side by side in its strip. */
    expect(
      within(dialog).getAllByText("This frame stopped before it finished."),
    ).toHaveLength(2);
    expect(
      within(dialog).queryByText("This frame is still rendering…"),
    ).toBeNull();
    expect(
      within(dialog).getByRole("button", { name: "Retry frame 4" }),
    ).toBeEnabled();
    expect(setJobsFor(BRAND)).toEqual([]);
  });

  it("says a frame long past any set's time has stopped, with no job of ours to ask", () => {
    const stuck = frameRows(5).map((row, i) =>
      i === 4 ? { ...row, status: "pending", url: null } : row,
    ) as SerializedGeneration[];
    renderStudio(stuck);
    expect(
      screen.getByRole("button", {
        name: "Open carousel, 5 slides: The launch. 1 didn't render",
      }),
    ).toBeInTheDocument();
  });

  it("keeps a fresh frame rendering while it is read again, with no job of ours", async () => {
    const initial = buildingSet(4);
    rowsOnServer = initial;
    renderStudio(initial);
    await waitFor(() =>
      expect(urls()).toContain(
        `/api/design/generations?brandId=${BRAND}&ids=f4`,
      ),
    );
    expect(urls().some((u) => u.startsWith("/api/jobs/"))).toBe(false);
    expect(
      screen.getByRole("button", { name: /Still being made, 4 of 5 ready/ }),
    ).toBeInTheDocument();
  });

  it("holds a place in the grid for a set of ours with no frame ready yet", async () => {
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set" });
    jobReply = () =>
      respond({
        status: "running",
        result: null,
        error: null,
        progress: {
          stage: "brief",
          done: 0,
          total: 5,
          label: "x",
          sequenceKind: "carousel",
        },
      });
    renderStudio([singleRow("s1")]);
    expect(
      await screen.findByText("Making your carousel. Planning…"),
    ).toBeInTheDocument();
    expect(
      screen
        .getByText("Making your carousel. Planning…")
        .closest("[role=status]"),
    ).not.toBeNull();
  });
});
