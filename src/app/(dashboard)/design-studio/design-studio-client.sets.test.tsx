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
import { withDesignFlags } from "@/lib/testing/ko-imagery";
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

function renderStudio(initial: SerializedGeneration[], multiFrame = true) {
  return render(
    <DesignStudioClient
      brandId={BRAND}
      brandName="Lagos Loom"
      initialGenerations={initial}
    />,
    withDesignFlags({ koImagery: true, multiFrame }),
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
/* What GET /api/design/set-jobs lists: the user's open set jobs for the
   brand, wherever they were started. */
let openJobs: unknown[];
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));
const LIST_URL = `/api/design/set-jobs?brandId=${BRAND}`;

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  rowsOnServer = [];
  openJobs = [];
  jobReply = () =>
    respond({
      status: "running",
      result: null,
      error: null,
      progress: { stage: "render", done: 3, total: 5, label: "x" },
    });
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/jobs/")) return jobReply();
    if (url.startsWith("/api/design/set-jobs")) {
      return respond({ jobs: openJobs });
    }
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

  /* Once, on arrival, for a set started on another device; then nothing
     while there is nothing to watch. */
  it("asks only for the open set jobs, once, while there is nothing to watch", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderStudio([...frames, singleRow("s1")]);
    await waitFor(() => expect(urls()).toEqual([LIST_URL]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS * 12);
    });
    expect(urls()).toEqual([LIST_URL]);
  });

  /* Round 3 M4: a set where every frame failed used to vanish. */
  it("keeps a card for a set where every frame failed, opening to its retries", async () => {
    renderStudio(
      frameRows(5).map((r) => ({
        ...r,
        status: "failed",
        url: null,
      })) as SerializedGeneration[],
    );
    const card = screen.getByRole("button", {
      name: "Open carousel, 5 slides: The launch. None of its frames rendered. Open it to retry them",
    });
    await userEvent.click(card);
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Retry frame 1" }),
    ).toBeEnabled();
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
    const announcer = () =>
      dialog.querySelector('[data-viewer-status] [data-announce="building"]');
    expect(announcer()).toHaveTextContent(/^Frame 4 of 5… 3 of 5 ready/);
    expect(within(dialog).getAllByRole("status")).toHaveLength(1);

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
    await waitFor(() => expect(announcer()).toBeNull());
    expect(within(dialog).queryByText(/^Frame \d of 5…/)).toBeNull();
    expect(setJobsFor(BRAND)).toEqual([]);
  });

  it("turns frames still pending into failed frames with a retry when the job failed", async () => {
    const initial = buildingSet(3);
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set", setId: SET });
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

  /* Round 3 M2: an ended job that never said which set it built stops
     nothing; the set may be another job's, still on its way. */
  it("does not stop a set over a job that ended without naming its set", async () => {
    const initial = buildingSet(3);
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set" });
    rowsOnServer = initial;
    jobReply = () =>
      respond({ status: "failed", result: null, error: "Stalled." });
    renderStudio(initial);
    await waitFor(() => expect(setJobsFor(BRAND)).toEqual([]));
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: /Still being made, 3 of 5 ready/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /didn't render/ })).toBeNull();
  });

  it("does not stop a set's other frames over a failed frame job", async () => {
    const initial = buildingSet(3);
    rememberSetJob({
      jobId: "job-frame",
      brandId: BRAND,
      kind: "frame",
      sequenceKind: "carousel",
      setId: SET,
    });
    rowsOnServer = initial;
    jobReply = () =>
      respond({ status: "failed", result: null, error: "Stalled." });
    renderStudio(initial);
    await waitFor(() => expect(setJobsFor(BRAND)).toEqual([]));
    await act(async () => {});
    expect(
      screen.getByRole("button", { name: /Still being made, 3 of 5 ready/ }),
    ).toBeInTheDocument();
  });

  it("stops only the set whose job ended, and leaves another recent set building", async () => {
    const OTHER = "0c0ffee0-0000-4000-8000-000000000002";
    const mine = buildingSet(3);
    const theirs = buildingSet(4).map((row) => ({
      ...row,
      id: `b-${row.id}`,
      frame: row.frame ? { ...row.frame, setId: OTHER } : null,
    })) as SerializedGeneration[];
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set", setId: SET });
    rowsOnServer = [...mine, ...theirs];
    jobReply = () =>
      respond({ status: "failed", result: null, error: "Stalled." });
    renderStudio([...mine, ...theirs]);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Open carousel, 5 slides: The launch. 2 didn't render",
        }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", {
        name: "Open carousel, 5 slides: The launch. Still being made, 4 of 5 ready",
      }),
    ).toBeInTheDocument();
  });

  /* Round 3 M3: a set started on the phone, in a private window, or before
     site data was cleared is known to the server, not this browser. */
  it("drives a set this browser never started, from the server's list", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const initial = buildingSet(3);
    rowsOnServer = initial;
    openJobs = [
      {
        jobId: "job-phone",
        kind: "set",
        sequenceKind: "carousel",
        setId: SET,
        startedAt: Date.now() - 60_000,
      },
    ];
    jobReply = () =>
      respond({
        status: "running",
        result: null,
        error: null,
        progress: {
          stage: "render",
          done: 3,
          total: 5,
          label: "x",
          sequenceKind: "carousel",
          setId: SET,
        },
      });
    renderStudio(initial);
    await waitFor(() => expect(urls()).toContain("/api/jobs/job-phone"));
    expect(setJobsFor(BRAND)).toEqual([]);

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
      expect(
        screen.getByRole("button", {
          name: "Open carousel, 5 slides: The launch",
        }),
      ).toBeInTheDocument(),
    );
    expect(document.querySelector("[data-set-building]")).toBeNull();
  });

  /* Round 3 L6: the placeholder is per job. */
  it("shows no placeholder beside the card of the set its job is checking", async () => {
    const done = frameRows(5).map((r) => ({ ...r, createdAt: justNow() }));
    rememberSetJob({ jobId: "job-9", brandId: BRAND, kind: "set", setId: SET });
    jobReply = () =>
      respond({
        status: "running",
        result: null,
        error: null,
        progress: { stage: "checks", done: 5, total: 5, label: "x" },
      });
    renderStudio(done);
    await waitFor(() => expect(urls()).toContain("/api/jobs/job-9"));
    await act(async () => {});
    expect(document.querySelector("[data-set-building]")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Open carousel, 5 slides: The launch",
      }),
    ).toBeInTheDocument();
  });

  it("holds a place for a new set while an older one is still building", async () => {
    const older = frameRows(5).map((row, i) =>
      i >= 3
        ? {
            ...row,
            status: "pending",
            url: null,
            createdAt: new Date(Date.now() - 300_000).toISOString(),
          }
        : { ...row, createdAt: new Date(Date.now() - 300_000).toISOString() },
    ) as SerializedGeneration[];
    rowsOnServer = older;
    rememberSetJob({
      jobId: "job-new",
      brandId: BRAND,
      kind: "set",
      sequenceKind: "presentation",
    });
    jobReply = () =>
      respond({
        status: "running",
        result: null,
        error: null,
        progress: { stage: "brief", done: 0, total: 6, label: "x" },
      });
    renderStudio(older);
    expect(
      await screen.findByText("Making your presentation. Planning…"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Still being made, 3 of 5 ready/ }),
    ).toBeInTheDocument();
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

/* Integration round 2, MEDIUM 1: turned off as a kill switch, the flag
   still left existing sets showing ZIP, PDF, Edit and Regenerate (each a
   404 behind a "try again" message), and the studio asked for
   /api/design/set-jobs on every load. */
describe("Design Studio with FEATURE_MULTI_FRAME off", () => {
  const frames = frameRows(5);

  it("never asks for the server's set jobs", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderStudio([...frames, singleRow("s1")], false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS * 12);
    });
    expect(urls().filter((u) => u.startsWith("/api/design/set-jobs"))).toEqual(
      [],
    );
  });

  it("opens an existing set with per-frame downloads only", async () => {
    renderStudio(frames, false);
    await userEvent.click(
      screen.getByRole("button", { name: /^Open carousel/ }),
    );
    const dialog = await screen.findByRole("dialog");
    for (const name of [
      "Download ZIP",
      "Download PDF",
      "Edit & regenerate frame 1",
      "Regenerate frame 1",
    ]) {
      expect(within(dialog).queryByRole("button", { name })).toBeNull();
    }
    expect(
      within(dialog).getByRole("link", { name: /Download this frame/ }),
    ).toBeInTheDocument();
  });

  it("promises no retry on a set none of whose frames rendered", () => {
    renderStudio(
      frames.map((r) => ({
        ...r,
        status: "failed",
        url: null,
      })) as SerializedGeneration[],
      false,
    );
    expect(
      screen.getByRole("button", {
        name: "Open carousel, 5 slides: The launch. None of its frames rendered",
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Open it to retry its frames")).toBeNull();
  });
});
