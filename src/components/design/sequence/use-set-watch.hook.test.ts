import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_GENERATION_IDS } from "@/lib/design/generation-ids";
import type { SerializedGeneration } from "@/lib/design/serialize";
import { BRAND, frameRow } from "./fixtures";
import {
  SET_WATCH_HIDDEN_INTERVAL_MS,
  SET_WATCH_INTERVAL_MS,
  useSetWatch,
} from "./use-set-watch";

const DECK = "0d5b3c5e-6f1a-4b8e-9a51-6c7f3d2e1a10";
const CAROUSEL = "7f2c9a41-3b6d-4e0f-8c2a-1d9e5b7a4c22";

function pendingSet(setId: string, prefix: string, count: number) {
  const createdAt = new Date(Date.now() - 60_000).toISOString();
  return Array.from({ length: count }, (_, index) => {
    const row = frameRow(index, {
      count,
      status: "pending",
      url: null,
      createdAt,
    });
    return {
      ...row,
      id: `${prefix}${index}`,
      frame: row.frame ? { ...row.frame, setId } : null,
    } as SerializedGeneration;
  });
}

let given: SerializedGeneration[];
let rowReads: string[][];
let failRowReads: (ids: string[]) => boolean;

function rendered(row: SerializedGeneration): SerializedGeneration {
  return { ...row, status: "succeeded", url: `https://cdn.example/${row.id}` };
}

function respond(url: string): Response {
  const parsed = new URL(url, "http://localhost");
  if (parsed.pathname === "/api/design/set-jobs") {
    return Response.json({ jobs: [] });
  }
  if (parsed.pathname === "/api/design/generations") {
    const ids = (parsed.searchParams.get("ids") ?? "").split(",");
    rowReads.push(ids);
    /* The route's own rule (route.ts MAX_IDS). */
    if (ids.length > MAX_GENERATION_IDS) {
      return Response.json({ error: "Invalid ids" }, { status: 400 });
    }
    if (failRowReads(ids)) {
      return Response.json({ error: "down" }, { status: 503 });
    }
    return Response.json({
      generations: given.filter((g) => ids.includes(g.id)).map(rendered),
    });
  }
  return Response.json({ error: "unexpected" }, { status: 404 });
}

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  rowReads = [];
  failRowReads = () => false;
  setHidden(false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => respond(url)),
  );
  /* A 12-slide deck and a 10-slide carousel building at once: 22 pending
     frames, two more than one read may ask for. */
  given = [...pendingSet(DECK, "d", 12), ...pendingSet(CAROUSEL, "c", 10)];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("useSetWatch", () => {
  /* Round 4 H1: all 22 ids went out in one read, the route answered 400,
     and the read was swallowed as "nothing changed": no frame of either set
     ever swapped in. */
  it("reads more pending frames than the route's id limit in chunks, and swaps every one in", async () => {
    const { result } = renderHook(() => useSetWatch(BRAND, given));
    await flush();

    expect(rowReads.every((ids) => ids.length <= MAX_GENERATION_IDS)).toBe(
      true,
    );
    expect(new Set(rowReads.flat()).size).toBe(22);
    expect(result.current.rows).toHaveLength(22);
    expect(
      result.current.rows.filter((g) => g.status === "succeeded"),
    ).toHaveLength(22);
    expect(result.current.stalled.size).toBe(0);
  });

  it("keeps the chunks that answered when one fails, and asks for the rest again", async () => {
    let down = true;
    failRowReads = (ids) => down && ids.includes("c9");
    const { result } = renderHook(() => useSetWatch(BRAND, given));
    await flush();

    const ready = () =>
      result.current.rows.filter((g) => g.status === "succeeded").length;
    expect(ready()).toBeGreaterThan(0);
    expect(ready()).toBeLessThan(22);

    down = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS);
    });
    expect(ready()).toBe(22);
  });

  /* Round 4 L4: a background tab polled every 3s all day. */
  it("slows to one tick every half minute while the tab is hidden, and ticks at once on return", async () => {
    failRowReads = () => true;
    const reads = () => rowReads.length;
    renderHook(() => useSetWatch(BRAND, given));
    await flush();
    const afterFirst = reads();
    expect(afterFirst).toBeGreaterThan(0);

    setHidden(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS);
    });
    const hiddenStart = reads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_INTERVAL_MS * 5);
    });
    expect(reads()).toBe(hiddenStart);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SET_WATCH_HIDDEN_INTERVAL_MS);
    });
    expect(reads()).toBeGreaterThan(hiddenStart);

    const beforeReturn = reads();
    setHidden(false);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(reads()).toBeGreaterThan(beforeReturn);
  });
});
