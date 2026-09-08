import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pollGenerationJob = vi.fn();
vi.mock("@/lib/generation/poll-job", () => ({
  pollGenerationJob: (...a: unknown[]) => pollGenerationJob(...a),
}));

import { useDesignGeneration } from "./use-design-generation";

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const ARGS = { brandId: BRAND };

const row = (id: string, status = "succeeded") => ({
  id,
  status,
  imageUrl: `https://cdn/${id}.png`,
});

let fetchMock: ReturnType<typeof vi.fn>;

/** Every request the hook made, in order. */
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

beforeEach(() => {
  vi.clearAllMocks();
  pollGenerationJob.mockResolvedValue({
    generationIds: ["g1", "g2"],
    failed: [],
  });
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).includes("/api/design/generate")) {
      return new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 });
    }
    return new Response(
      JSON.stringify({ generations: [row("g1"), row("g2")] }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("a finished run reads back exactly its own designs", () => {
  /* The reported bug: the hook asked for the brand's NEWEST N generations and
     filtered that page down to this run's ids. Anything newer for the same
     brand pushed the run's rows out of the window, the filter emptied, and a
     successful generation rendered "No designs yet" while the designs were
     visible in Design Studio. */
  it("asks for the rows by id, not for the newest N", async () => {
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    const listUrl = urls().find((u) => u.includes("/api/design/generations"));
    expect(listUrl).toContain("ids=g1,g2");
    expect(listUrl).not.toContain("limit=");
  });

  it("shows the designs the job produced", async () => {
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.generations.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(result.current.error).toBeNull();
  });

  /* The exact scenario from the report: another generation for the same brand
     is newer. Addressing by id makes that irrelevant — under the old
     newest-N request this returned an empty list. */
  it("is unaffected by newer designs on the same brand", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/api/design/generate")
        ? new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 })
        : new Response(
            JSON.stringify({ generations: [row("g1"), row("g2")] }),
            { status: 200 },
          ),
    );
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.generations).toHaveLength(2);
  });
});

describe("partial success is stated, not silently shown", () => {
  it("keeps the designs that rendered and says what is missing", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/api/design/generate")
        ? new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 })
        : new Response(
            JSON.stringify({ generations: [row("g1"), row("g2", "failed")] }),
            { status: 200 },
          ),
    );
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.generations.map((g) => g.id)).toEqual(["g1"]);
    expect(result.current.partial).toMatch(/1 of 2/);
    // An error would replace the usable design with a message.
    expect(result.current.error).toBeNull();
  });

  it("says nothing when everything came back", async () => {
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.partial).toBeNull();
  });
});

describe("a genuine failure is an error, not an empty state", () => {
  it("errors when the job produced nothing", async () => {
    pollGenerationJob.mockResolvedValue({ generationIds: [], failed: ["x"] });
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.error).toMatch(/could not be generated/i);
    expect(result.current.generations).toEqual([]);
    // It must not have asked for an empty id list.
    expect(urls().some((u) => u.includes("ids="))).toBe(false);
  });

  it("errors when every produced design failed to render", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/api/design/generate")
        ? new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 })
        : new Response(
            JSON.stringify({
              generations: [row("g1", "failed"), row("g2", "failed")],
            }),
            { status: 200 },
          ),
    );
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.error).toMatch(/could not be generated/i);
  });
});

describe("retrying does not generate the same designs twice", () => {
  /* The ticket's own criterion. A display-only failure means the designs
     already exist and were already paid for; re-running would leave
     duplicates behind and charge again. */
  it("re-reads the job's designs instead of regenerating", async () => {
    let listCalls = 0;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/api/design/generate")) {
        return new Response(JSON.stringify({ jobId: "job-1" }), {
          status: 200,
        });
      }
      listCalls += 1;
      return listCalls === 1
        ? new Response(JSON.stringify({ error: "Upstream hiccup" }), {
            status: 500,
          })
        : new Response(
            JSON.stringify({ generations: [row("g1"), row("g2")] }),
            { status: 200 },
          );
    });

    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.error).toBeTruthy();

    await act(async () => {
      await result.current.retry();
    });

    expect(result.current.generations).toHaveLength(2);
    expect(result.current.error).toBeNull();
    // Exactly ONE generation was ever started.
    expect(
      urls().filter((u) => u.includes("/api/design/generate")),
    ).toHaveLength(1);
    // And the job was never polled a second time.
    expect(pollGenerationJob).toHaveBeenCalledTimes(1);
  });

  /* When the job produced nothing there is nothing to re-read, so a retry has
     to be a real re-run. */
  it("re-runs the generation when the job produced nothing", async () => {
    pollGenerationJob.mockResolvedValue({ generationIds: [], failed: ["x"] });
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    await act(async () => {
      await result.current.retry();
    });
    expect(
      urls().filter((u) => u.includes("/api/design/generate")),
    ).toHaveLength(2);
  });

  it("does nothing when there is no run to retry", async () => {
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.retry();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reset clears everything the run left behind", () => {
  it("clears the partial notice as well as the designs", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      String(url).includes("/api/design/generate")
        ? new Response(JSON.stringify({ jobId: "job-1" }), { status: 200 })
        : new Response(
            JSON.stringify({ generations: [row("g1"), row("g2", "failed")] }),
            { status: 200 },
          ),
    );
    const { result } = renderHook(() => useDesignGeneration());
    await act(async () => {
      await result.current.generate(ARGS);
    });
    expect(result.current.partial).toBeTruthy();

    act(() => result.current.reset());
    expect(result.current.partial).toBeNull();
    expect(result.current.generations).toEqual([]);
    expect(result.current.error).toBeNull();
  });
});

/* A superseded run must not overwrite the state of the one that replaced it —
   the ticket's "generation and display states remain synchronized if the user
   navigates or the response is delayed". */
describe("a superseded run cannot overwrite fresh state", () => {
  it("drops a late result after reset", async () => {
    let release: ((v: unknown) => void) | undefined;
    pollGenerationJob.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() => useDesignGeneration());

    // Started, then abandoned before the job reports back.
    const running = result.current.generate(ARGS);
    await waitFor(() => expect(pollGenerationJob).toHaveBeenCalled());
    act(() => result.current.reset());

    // The abandoned job finally answers.
    release?.({ generationIds: ["old"], failed: [] });
    await running;

    expect(result.current.generations).toEqual([]);
    expect(result.current.pending).toBe(false);
    // It must not have gone on to read rows for a run nobody is watching.
    expect(urls().some((u) => u.includes("ids=old"))).toBe(false);
  });
});
