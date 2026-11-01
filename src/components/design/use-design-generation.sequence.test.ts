import { act, renderHook, waitFor } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import type { SerializedGeneration } from "@/lib/design/serialize";

const pollGenerationJob = vi.fn();
vi.mock("@/lib/generation/poll-job", () => ({
  pollGenerationJob: (...a: unknown[]) => pollGenerationJob(...a),
}));

import {
  BRAND,
  frameRow,
  frameRows,
  SET,
} from "@/components/design/sequence/fixtures";
import { setJobsFor } from "@/components/design/sequence/set-jobs";
import {
  FRAME_STILL_RUNNING,
  regenKey,
} from "@/components/design/sequence/use-frame-set";
import {
  PollConnectionLostError,
  PollTimeoutError,
} from "@/lib/generation/poll-errors";
import {
  SET_POLL_TIMEOUT_MS,
  useDesignGeneration,
} from "./use-design-generation";

const ARGS = {
  brandId: BRAND,
  briefId: "brief-1",
  image: { source: "none" as const },
};
const CAROUSEL = { sequenceKind: "carousel" as const };

const SEQUENCE = {
  kind: "sequence" as const,
  setId: SET,
  sequenceKind: "carousel" as const,
  frameCount: 5,
  generationIds: ["f0", "f1", "f2", "f3", "f4"],
  failed: [] as string[],
  imageSource: "none" as const,
};

let rows: SerializedGeneration[];
let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

/* What /api/jobs/[id] says once the poll has given up on job-1. */
let jobStatus: "running" | "failed" | "succeeded";

async function serve(url: string, _init?: RequestInit): Promise<Response> {
  if (url.includes("/api/design/generate")) return respond({ jobId: "job-1" });
  if (url.startsWith("/api/jobs/")) {
    return respond({ status: jobStatus, result: null, error: null });
  }
  if (url.includes("/regenerate-frame"))
    return respond({ jobId: "job-2" }, 202);
  const ids = new URL(url, "http://x").searchParams.get("ids")?.split(",");
  /* Shuffled on purpose: the set's order comes from frame.index, never from
     the order the server listed the rows in. */
  return respond({
    generations: rows.filter((r) => ids?.includes(r.id)).reverse(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  rows = frameRows(5);
  jobStatus = "running";
  pollGenerationJob.mockResolvedValue(SEQUENCE);
  fetchMock = vi.fn(serve);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

async function generated() {
  const hook = renderHook(() => useDesignGeneration());
  await act(async () => {
    await hook.result.current.generate(ARGS, CAROUSEL);
  });
  return hook;
}

const generatePosts = () =>
  urls().filter((u) => u.includes("/api/design/generate"));

describe("a sequence job comes back as one set", () => {
  /* The frame count is the server's to read from the brief (slides), and
     the expected kind is the client's own: neither goes on the wire. */
  it("posts the brief's request and nothing the client only knows", async () => {
    await generated();
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/design/generate"),
    );
    expect(JSON.parse(String(call?.[1]?.body))).toEqual(ARGS);
  });

  it("gives a set run a set's length of time to finish", async () => {
    await generated();
    const timeoutMs = pollGenerationJob.mock.calls[0]?.[1]?.timeoutMs;
    expect(timeoutMs).toBeLessThanOrEqual(SET_POLL_TIMEOUT_MS);
    expect(timeoutMs).toBeGreaterThan(SET_POLL_TIMEOUT_MS - 5000);
    const single = renderHook(() => useDesignGeneration());
    pollGenerationJob.mockClear();
    await act(async () => {
      await single.result.current.generate(ARGS);
    });
    /* A directions run polls with exactly the options it always had. */
    expect(Object.keys(pollGenerationJob.mock.calls[0]?.[1] ?? {})).toEqual([
      "onProgress",
    ]);
  });

  /* L8: a known carousel must not wait under "Creating two directions"
     until the job's first report, up to a 3s poll away. */
  it("opens a known set on its planning wait before the job reports", async () => {
    pollGenerationJob.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useDesignGeneration());
    act(() => {
      void result.current.generate(ARGS, CAROUSEL);
    });
    expect(result.current.sequenceProgress).toEqual({
      kind: "carousel",
      frameCount: null,
      phase: "plan",
      done: 0,
    });
  });

  /* M4: FRAME_BOUNDS.carousel.min is 2. */
  it("reads a two-frame carousel's progress as the set's", async () => {
    pollGenerationJob.mockImplementation(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({ stage: "render", done: 1, total: 2, label: "x" });
        return new Promise(() => {});
      },
    );
    const { result } = renderHook(() => useDesignGeneration());
    act(() => {
      void result.current.generate(ARGS, CAROUSEL);
    });
    await waitFor(() =>
      expect(result.current.sequenceProgress).toEqual({
        kind: "carousel",
        frameCount: 2,
        phase: "render",
        done: 1,
      }),
    );
  });

  it("reads a set from the job's own mark when the caller named none", async () => {
    pollGenerationJob.mockImplementation(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({
          stage: "brief",
          done: 0,
          total: 2,
          label: "x",
          sequenceKind: "carousel",
        });
        return new Promise(() => {});
      },
    );
    const { result } = renderHook(() => useDesignGeneration());
    act(() => {
      void result.current.generate(ARGS);
    });
    await waitFor(() =>
      expect(result.current.sequenceProgress?.kind).toBe("carousel"),
    );
  });

  it("loads the frames by id and holds them in index order", async () => {
    const { result } = await generated();
    expect(urls().find((u) => u.includes("ids="))).toContain(
      "ids=f0,f1,f2,f3,f4",
    );
    expect(result.current.set?.setId).toBe(SET);
    expect(result.current.set?.kind).toBe("carousel");
    expect(result.current.set?.frames.map((f) => f.generation?.id)).toEqual([
      "f0",
      "f1",
      "f2",
      "f3",
      "f4",
    ]);
    expect(result.current.generations.map((g) => g.id)).toEqual([
      "f0",
      "f1",
      "f2",
      "f3",
      "f4",
    ]);
    expect(result.current.error).toBeNull();
    expect(result.current.partial).toBeNull();
  });

  it("reads failed frames too, so each keeps its place", async () => {
    rows[3] = frameRow(3, { status: "failed", url: null });
    pollGenerationJob.mockResolvedValue({
      ...SEQUENCE,
      generationIds: ["f0", "f1", "f2", "f4"],
      failed: ["f3"],
    });
    const { result } = await generated();
    expect(urls().find((u) => u.includes("ids="))).toContain(
      "ids=f0,f1,f2,f4,f3",
    );
    expect(result.current.set?.frames[3]?.generation?.status).toBe("failed");
    expect(result.current.failedIds).toEqual(["f3"]);
    expect(result.current.partial).toMatch(/^4 of 5 frames came back/);
  });

  it("is an error, not an empty set, when no frame rendered", async () => {
    pollGenerationJob.mockResolvedValue({
      ...SEQUENCE,
      generationIds: [],
      failed: [],
    });
    const { result } = await generated();
    expect(result.current.set).toBeNull();
    expect(result.current.error).toBe(
      "That carousel could not be generated. Please try again.",
    );
  });

  it("re-reads the same set on retry after a display failure, never re-generates", async () => {
    let fail = true;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).includes("ids=") && fail) {
        return respond({ error: "Could not load." }, 500);
      }
      return serve(url, init);
    });
    const { result } = await generated();
    expect(result.current.error).toBe("Could not load.");
    fail = false;
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.set?.frames).toHaveLength(5);
    expect(
      urls().filter((u) => u.includes("/api/design/generate")),
    ).toHaveLength(1);
  });

  /* The shape run-design-sequence reports (stage, done, total = frames),
     not a field of the client's own invention. */
  it("reads the sequence job's own progress as the set's, and clears it after", async () => {
    let release: (v: unknown) => void = () => {};
    pollGenerationJob.mockImplementation(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({
          stage: "render",
          done: 2,
          total: 5,
          label: "Frame 2 of 5…",
        });
        return new Promise((resolve) => (release = resolve));
      },
    );
    const { result } = renderHook(() => useDesignGeneration());
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.generate(ARGS, CAROUSEL);
    });
    await waitFor(() =>
      expect(result.current.sequenceProgress).toEqual({
        kind: "carousel",
        frameCount: 5,
        phase: "render",
        done: 2,
      }),
    );
    await act(async () => {
      release(SEQUENCE);
      await run;
    });
    expect(result.current.sequenceProgress).toBeNull();
  });

  it("keeps a directions run's progress out of the set wait", async () => {
    pollGenerationJob.mockImplementation(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({ stage: "brief", done: 0, total: 2, label: "x" });
        return new Promise(() => {});
      },
    );
    const { result } = renderHook(() => useDesignGeneration());
    act(() => {
      void result.current.generate(ARGS);
    });
    await waitFor(() => expect(result.current.jobStage).toBe("brief"));
    expect(result.current.sequenceProgress).toBeNull();
  });

  it("leaves a directions job exactly as before: no set", async () => {
    pollGenerationJob.mockResolvedValue({ generationIds: ["f0"], failed: [] });
    const { result } = await generated();
    expect(result.current.set).toBeNull();
    expect(result.current.generations.map((g) => g.id)).toEqual(["f0"]);
  });
});

/* H7/H8: a set can outlive any poll timeout while its job resumes slice by
   slice. Giving up on watching is not the job failing, and a retry must
   never post a second N-unit job for one still running. */
describe("a set that outlives the poll", () => {
  const timedOut = () =>
    pollGenerationJob.mockRejectedValueOnce(new PollTimeoutError());
  const jobReads = () => urls().filter((u) => u.startsWith("/api/jobs/"));

  it("says it is still being made, and retry watches the same job", async () => {
    timedOut();
    const { result } = await generated();
    expect(result.current.stillRunning).toBe(true);
    expect(result.current.error).toMatch(
      /^Your carousel is still being made\./,
    );
    expect(result.current.set).toBeNull();
    /* Told apart by the error's type: no second request to find out. */
    expect(jobReads()).toEqual([]);

    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(1);
    expect(pollGenerationJob).toHaveBeenCalledTimes(2);
    expect(pollGenerationJob.mock.calls[1]?.[0]).toBe("job-1");
    expect(result.current.stillRunning).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.set?.frames).toHaveLength(5);
  });

  it("keeps watching through any number of timeouts without a second job", async () => {
    timedOut();
    timedOut();
    const { result } = await generated();
    await act(async () => {
      await result.current.retry();
    });
    expect(result.current.stillRunning).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(1);
    expect(result.current.set?.frames).toHaveLength(5);
  });

  it("counts a lost connection as still running, not as failed", async () => {
    pollGenerationJob.mockRejectedValueOnce(new PollConnectionLostError());
    const { result } = await generated();
    expect(result.current.stillRunning).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(1);
  });

  it("runs again only once the job is known to have failed", async () => {
    pollGenerationJob.mockRejectedValueOnce(new Error("The planner failed."));
    const { result } = await generated();
    expect(result.current.stillRunning).toBe(false);
    expect(result.current.error).toBe("The planner failed.");
    expect(jobReads()).toEqual([]);
    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(2);
    expect(result.current.set?.frames).toHaveLength(5);
  });

  /* H6: still-running is the set's. A directions run that times out ends in
     its own error and "Try again" runs it again, exactly as before. */
  it("leaves a directions run's timeout as that run's error", async () => {
    timedOut();
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.stillRunning).toBe(false);
    expect(result.current.error).toBe(
      "Generation is taking longer than expected. Please try again.",
    );
    expect(jobReads()).toEqual([]);
    pollGenerationJob.mockResolvedValueOnce({
      generationIds: ["f0"],
      failed: [],
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(2);
  });

  /* A run nobody named as a set learns it is one from its progress, after
     its poll already began with the directions run's five minutes. */
  it("gives a run that shows itself a set mid-poll the set's time", async () => {
    pollGenerationJob.mockImplementationOnce(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({ stage: "render", done: 1, total: 5, label: "x" });
        return Promise.reject(new PollTimeoutError());
      },
    );
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(pollGenerationJob).toHaveBeenCalledTimes(2);
    expect(pollGenerationJob.mock.calls[1]?.[0]).toBe("job-1");
    expect(pollGenerationJob.mock.calls[1]?.[1]?.timeoutMs).toBeGreaterThan(0);
    expect(result.current.set?.frames).toHaveLength(5);
    expect(generatePosts()).toHaveLength(1);
  });

  it("names slides, not a kind, when nothing named the set", async () => {
    pollGenerationJob.mockImplementationOnce(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({ stage: "render", done: 1, total: 5, label: "x" });
        return Promise.reject(new PollTimeoutError());
      },
    );
    timedOut();
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.stillRunning).toBe(true);
    expect(result.current.error).toMatch(/^Your slides are still being made/);
  });

  /* H11: the wait says Design Studio picks the set up; that is only true if
     the job is kept where Design Studio looks for it. */
  it("keeps a set's job for Design Studio until it is known to have ended", async () => {
    timedOut();
    const { result } = await generated();
    expect(setJobsFor(BRAND).map((j) => j.jobId)).toEqual(["job-1"]);
    await act(async () => {
      await result.current.retry();
    });
    expect(setJobsFor(BRAND)).toEqual([]);
  });

  /* The wait was closed mid-run: the poll still ends here, but nothing on
     screen shows it any more, so the job is left for Design Studio to
     collect and put in the grid. */
  it("leaves a closed wait's set job for Design Studio to collect", async () => {
    let release: (v: unknown) => void = () => {};
    pollGenerationJob.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const { result } = renderHook(() => useDesignGeneration());
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.generate(ARGS, CAROUSEL);
    });
    await waitFor(() => expect(generatePosts()).toHaveLength(1));
    act(() => result.current.reset());
    await act(async () => {
      release(SEQUENCE);
      await run;
    });
    expect(setJobsFor(BRAND).map((j) => j.jobId)).toEqual(["job-1"]);
  });

  it("never keeps a directions run's job", async () => {
    pollGenerationJob.mockResolvedValueOnce({
      generationIds: ["f0"],
      failed: [],
    });
    timedOut();
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(setJobsFor(BRAND)).toEqual([]);
  });

  it("reopens the set's wait where it was on Keep waiting", async () => {
    pollGenerationJob.mockImplementationOnce(
      (_id: string, opts: { onProgress: (p: unknown) => void }) => {
        opts.onProgress({ stage: "render", done: 3, total: 5, label: "x" });
        return Promise.reject(new PollTimeoutError());
      },
    );
    const { result } = await generated();
    pollGenerationJob.mockImplementationOnce(() => new Promise(() => {}));
    act(() => {
      void result.current.retry();
    });
    expect(result.current.sequenceProgress).toEqual({
      kind: "carousel",
      frameCount: 5,
      phase: "render",
      done: 3,
    });
  });
});

describe("regenerateFrame", () => {
  it("posts the edits, polls the job and swaps the new row in place", async () => {
    const { result } = await generated();
    rows.push(
      frameRow(2, {
        id: "f2-new",
        headline: "Only ₦12,000",
        createdAt: "2026-10-30T12:00:00.000Z",
      }),
    );
    pollGenerationJob.mockResolvedValue({
      kind: "frame",
      setId: SET,
      frameIndex: 2,
      generationId: "f2-new",
      replaced: "f2",
    });
    await act(async () => {
      await result.current.regenerateFrame("f2", { headline: "Only ₦12,000" });
    });

    const post = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/regenerate-frame"),
    );
    expect(String(post?.[0])).toBe(
      "/api/design/generations/f2/regenerate-frame",
    );
    expect(post?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({
      edits: { headline: "Only ₦12,000" },
    });
    expect(pollGenerationJob).toHaveBeenLastCalledWith("job-2");
    expect(result.current.set?.frames.map((f) => f.generation?.id)).toEqual([
      "f0",
      "f1",
      "f2-new",
      "f3",
      "f4",
    ]);
    expect(result.current.frameActions.size).toBe(0);
  });

  it("sends an empty body for a plain regenerate", async () => {
    const { result } = await generated();
    pollGenerationJob.mockResolvedValue({
      kind: "frame",
      setId: SET,
      frameIndex: 0,
      generationId: "f0",
      replaced: "f0",
    });
    await act(async () => {
      await result.current.regenerateFrame("f0");
    });
    const post = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/regenerate-frame"),
    );
    expect(JSON.parse(String(post?.[1]?.body))).toEqual({});
  });

  it("marks only that frame as working while it runs", async () => {
    const { result } = await generated();
    let release: (v: unknown) => void = () => {};
    pollGenerationJob.mockReturnValue(
      new Promise((resolve) => (release = resolve)),
    );
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.regenerateFrame("f1");
    });
    await waitFor(() =>
      expect([...result.current.frameActions]).toEqual([regenKey("f1")]),
    );
    rows.push(frameRow(1, { id: "f1-new", createdAt: "2026-10-30T12:00:00Z" }));
    await act(async () => {
      release({
        kind: "frame",
        setId: SET,
        frameIndex: 1,
        generationId: "f1-new",
        replaced: "f1",
      });
      await run;
    });
    expect(result.current.frameActions.size).toBe(0);
  });

  it("keeps the old frame and says why when the server refuses", async () => {
    const { result } = await generated();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) =>
      String(url).includes("/regenerate-frame")
        ? respond(
            { error: "This needs 1 design and you have 0 left this month." },
            429,
          )
        : serve(url, init),
    );
    let row: unknown;
    await act(async () => {
      row = await result.current.regenerateFrame("f3");
    });
    expect(row).toBeNull();
    expect(result.current.set?.frames[3]?.generation?.id).toBe("f3");
    expect(result.current.frameErrors[3]).toBe(
      "Regenerating didn't work, so this frame is unchanged. This needs 1 design and you have 0 left this month.",
    );
    expect(result.current.frameActions.size).toBe(0);
  });

  it("drops a result that lands after the set was closed", async () => {
    const { result } = await generated();
    let release: (v: unknown) => void = () => {};
    pollGenerationJob.mockReturnValue(
      new Promise((resolve) => (release = resolve)),
    );
    let run: Promise<unknown> = Promise.resolve();
    act(() => {
      run = result.current.regenerateFrame("f1");
    });
    act(() => result.current.reset());
    await act(async () => {
      release({
        kind: "frame",
        setId: SET,
        frameIndex: 1,
        generationId: "f1",
        replaced: "f1",
      });
      await run;
    });
    expect(result.current.set).toBeNull();
    expect(result.current.frameErrors).toEqual({});
  });
});

/* M6: a frame's job is billed when it starts. Giving up on watching it is
   not "didn't work", and a retry must follow the same job. */
describe("a frame regenerate that outlives the poll", () => {
  const frameResult = {
    kind: "frame" as const,
    setId: SET,
    frameIndex: 2,
    generationId: "f2-new",
    replaced: "f2",
  };
  const framePosts = () =>
    urls().filter((u) => u.includes("/regenerate-frame"));

  it("says the frame is still being made, never that it didn't work", async () => {
    const { result } = await generated();
    pollGenerationJob.mockRejectedValueOnce(new PollTimeoutError());
    await act(async () => {
      await result.current.regenerateFrame("f2");
    });
    expect([...result.current.framesStillRunning]).toEqual([2]);
    expect(result.current.frameErrors[2]).toBe(FRAME_STILL_RUNNING);
    expect(result.current.frameErrors[2]).not.toMatch(/didn't work/);
    expect(result.current.frameActions.size).toBe(0);
    expect(setJobsFor(BRAND).map((j) => j.jobId)).toEqual(["job-2"]);
  });

  it("keeps waiting on the same job and swaps the frame in when it lands", async () => {
    const { result } = await generated();
    pollGenerationJob.mockRejectedValueOnce(new PollConnectionLostError());
    await act(async () => {
      await result.current.regenerateFrame("f2");
    });
    rows.push(frameRow(2, { id: "f2-new", createdAt: "2026-10-30T12:00:00Z" }));
    pollGenerationJob.mockResolvedValueOnce(frameResult);
    await act(async () => {
      await result.current.keepWaitingOnFrame(2);
    });
    expect(framePosts()).toHaveLength(1);
    expect(pollGenerationJob).toHaveBeenLastCalledWith("job-2");
    expect(result.current.set?.frames[2]?.generation?.id).toBe("f2-new");
    expect(result.current.framesStillRunning.size).toBe(0);
    expect(result.current.frameErrors[2]).toBeUndefined();
    expect(setJobsFor(BRAND)).toEqual([]);
  });

  it("never posts a second job for a frame whose job may still deliver", async () => {
    const { result } = await generated();
    pollGenerationJob.mockRejectedValueOnce(new PollTimeoutError());
    await act(async () => {
      await result.current.regenerateFrame("f2");
    });
    await act(async () => {
      await result.current.regenerateFrame("f2", { headline: "Again" });
    });
    expect(framePosts()).toHaveLength(1);
  });

  it("still says didn't work when the frame's job failed", async () => {
    const { result } = await generated();
    pollGenerationJob.mockRejectedValueOnce(new Error("The render failed."));
    await act(async () => {
      await result.current.regenerateFrame("f2");
    });
    expect(result.current.framesStillRunning.size).toBe(0);
    expect(result.current.frameErrors[2]).toBe(
      "Regenerating didn't work, so this frame is unchanged. The render failed.",
    );
    expect(setJobsFor(BRAND)).toEqual([]);
  });
});

/* O4: the approved outline rides on the generate body as the user left it;
   the wait for the server to take it is its own signal. */
describe("a run from an approved outline", () => {
  const OUTLINE = {
    kind: "carousel" as const,
    points: [
      {
        id: "p1",
        role: "hook" as const,
        title: "The launch",
        point: "Opens Saturday.",
        source: "brief" as const,
      },
      {
        id: "u-1",
        role: "body" as const,
        title: "Free fitting",
        point: "Every order is fitted free.",
        source: "user" as const,
      },
      {
        id: "p5",
        role: "cta" as const,
        title: "Book",
        point: "Book at Lekki.",
        source: "brief" as const,
      },
    ],
  };

  it("posts the outline with the run's request", async () => {
    const hook = renderHook(() => useDesignGeneration());
    await act(async () => {
      await hook.result.current.generate(
        { ...ARGS, approvedOutline: OUTLINE },
        CAROUSEL,
      );
    });
    const call = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes("/api/design/generate"),
    );
    expect(JSON.parse(String(call?.[1]?.body)).approvedOutline).toEqual(
      OUTLINE,
    );
  });

  it("opens the set's wait on the approved count, before the job reports", async () => {
    pollGenerationJob.mockImplementation(() => new Promise(() => {}));
    const hook = renderHook(() => useDesignGeneration());
    act(() => {
      void hook.result.current.generate(
        { ...ARGS, approvedOutline: OUTLINE },
        CAROUSEL,
      );
    });
    expect(hook.result.current.sequenceProgress).toEqual({
      kind: "carousel",
      frameCount: 3,
      phase: "plan",
      done: 0,
    });
  });

  it("is posting only until the server answers the generate request", async () => {
    let answer: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((r) => {
          answer = r;
        }),
    );
    pollGenerationJob.mockImplementationOnce(() => new Promise(() => {}));
    const hook = renderHook(() => useDesignGeneration());
    act(() => {
      void hook.result.current.generate(
        { ...ARGS, approvedOutline: OUTLINE },
        CAROUSEL,
      );
    });
    expect(hook.result.current.posting).toBe(true);
    expect(hook.result.current.pending).toBe(true);
    await act(async () => answer(respond({ jobId: "job-1" }, 202)));
    await waitFor(() => expect(hook.result.current.posting).toBe(false));
    expect(hook.result.current.pending).toBe(true);
  });

  it("says which slide the server refused, not only that it refused", async () => {
    fetchMock.mockImplementationOnce(async () =>
      respond(
        {
          error: "Invalid outline",
          problems: [
            { point: 1, rule: "markup", detail: "The point holds markup." },
          ],
        },
        400,
      ),
    );
    const hook = renderHook(() => useDesignGeneration());
    await act(async () => {
      await hook.result.current.generate(
        { ...ARGS, approvedOutline: OUTLINE },
        CAROUSEL,
      );
    });
    expect(hook.result.current.error).toBe(
      "Invalid outline. Slide 2: The point holds markup.",
    );
    expect(hook.result.current.posting).toBe(false);
    expect(hook.result.current.pending).toBe(false);
  });
});
