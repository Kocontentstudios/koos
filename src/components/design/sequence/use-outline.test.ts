import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BRAND, plannedOutline } from "./fixtures";
import { useOutline } from "./use-outline";

const pending: { resolve: (r: Response) => void; signal?: AbortSignal }[] = [];
const fetchMock = vi.fn(
  (_url: string, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const signal = init?.signal ?? undefined;
      signal?.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
      pending.push({ resolve, signal });
    }),
);

const answer = (count: number) =>
  Response.json({ outline: plannedOutline(count) });

function mount() {
  return renderHook(() => useOutline("carousel", { brandId: BRAND }));
}

beforeEach(() => {
  pending.length = 0;
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("useOutline", () => {
  it("plans once however often ensure is called", async () => {
    const { result } = mount();
    act(() => result.current.ensure());
    act(() => result.current.ensure());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => pending[0].resolve(answer(5)));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    act(() => result.current.ensure());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lets the latest re-plan win when two overlap", async () => {
    const { result } = mount();
    act(() => result.current.ensure());
    await act(async () => pending[0].resolve(answer(5)));
    act(() => result.current.replan(7));
    act(() => result.current.replan(4));
    expect(pending[1].signal?.aborted).toBe(true);
    await act(async () => pending[2].resolve(answer(4)));
    await waitFor(() => {
      const state = result.current.state;
      expect(state.status === "ready" && state.draft.points.length).toBe(4);
    });
  });

  it("returns the id of the point it adds, even with an edit in the same tick", async () => {
    const { result } = mount();
    act(() => result.current.ensure());
    await act(async () => pending[0].resolve(answer(5)));
    let id: string | null = null;
    act(() => {
      result.current.edit("p2", "title", "Woven here");
      id = result.current.add();
    });
    expect(id).toBe("u-1");
    const state = result.current.state;
    if (state.status !== "ready") throw new Error("not ready");
    expect(state.draft.points[1].title).toBe("Woven here");
    expect(state.draft.points.map((p) => p.id)).toContain("u-1");
  });

  it("drops an answer that lands after reset", async () => {
    const { result } = mount();
    act(() => result.current.ensure());
    act(() => result.current.reset());
    expect(pending[0].signal?.aborted).toBe(true);
    expect(result.current.state.status).toBe("idle");
  });

  it("retries at the count that failed", async () => {
    const { result } = mount();
    act(() => result.current.replan(6));
    await act(async () =>
      pending[0].resolve(Response.json({ error: "nope" }, { status: 500 })),
    );
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    act(() => result.current.retry());
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)).frames).toBe(
      6,
    );
  });
});
