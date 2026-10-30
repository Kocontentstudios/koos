import { describe, expect, it } from "vitest";
import { chunkIds, MAX_GENERATION_IDS } from "./generation-ids";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);

describe("chunkIds", () => {
  it("keeps every chunk within what the route answers, in order, losing nothing", () => {
    const chunks = chunkIds(ids(45));
    expect(chunks.map((c) => c.length)).toEqual([20, 20, 5]);
    expect(chunks.every((c) => c.length <= MAX_GENERATION_IDS)).toBe(true);
    expect(chunks.flat()).toEqual(ids(45));
  });

  it("asks nothing for no ids, and once for an exact chunk", () => {
    expect(chunkIds([])).toEqual([]);
    expect(chunkIds(ids(20))).toHaveLength(1);
  });
});
