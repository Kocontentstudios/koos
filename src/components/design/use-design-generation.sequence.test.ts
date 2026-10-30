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
import { regenKey } from "@/components/design/sequence/use-frame-set";
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
    expect(pollGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ timeoutMs: SET_POLL_TIMEOUT_MS }),
    );
    const single = renderHook(() => useDesignGeneration());
    pollGenerationJob.mockClear();
    await act(async () => {
      await single.result.current.generate(ARGS);
    });
    expect(pollGenerationJob).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ timeoutMs: undefined }),
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
      void result.current.generate(ARGS, CAROUSEL);
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
    pollGenerationJob.mockRejectedValueOnce(
      new Error("Generation is taking longer than expected. Please try again."),
    );

  it("says it is still being made, and retry watches the same job", async () => {
    timedOut();
    const { result } = await generated();
    expect(result.current.stillRunning).toBe(true);
    expect(result.current.error).toMatch(
      /^Your carousel is still being made\./,
    );
    expect(result.current.set).toBeNull();

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

  it("counts an unreachable job as still running, not as failed", async () => {
    timedOut();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/jobs/")) throw new TypeError("offline");
      return serve(url, init);
    });
    const { result } = await generated();
    expect(result.current.stillRunning).toBe(true);
    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(1);
  });

  it("runs again only once the job is known to have failed", async () => {
    jobStatus = "failed";
    pollGenerationJob.mockRejectedValueOnce(new Error("The planner failed."));
    const { result } = await generated();
    expect(result.current.stillRunning).toBe(false);
    expect(result.current.error).toBe("The planner failed.");
    await act(async () => {
      await result.current.retry();
    });
    expect(generatePosts()).toHaveLength(2);
    expect(result.current.set?.frames).toHaveLength(5);
  });

  it("names designs, not a kind, when the run did not expect a set", async () => {
    timedOut();
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.error).toMatch(/^Your designs are still being made/);
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
