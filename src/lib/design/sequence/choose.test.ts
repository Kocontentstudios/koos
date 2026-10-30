import { describe, expect, it } from "vitest";
import {
  choiceResponseSchema,
  chosenIndex,
  leastProblems,
  shownOrder,
} from "./choose";

describe("leastProblems", () => {
  it("keeps every version tied for the fewest, in order", () => {
    expect(leastProblems([2, 0, 5, 0])).toEqual([1, 3]);
    expect(leastProblems([4])).toEqual([0]);
  });
});

describe("shownOrder", () => {
  it("is a permutation of every version", () => {
    const order = shownOrder(4);
    expect([...order].sort()).toEqual([0, 1, 2, 3]);
  });

  it("shuffles by the random source it is given", () => {
    expect(shownOrder(2, () => 0.99)).toEqual([0, 1]);
    expect(shownOrder(2, () => 0)).toEqual([1, 0]);
  });
});

describe("chosenIndex", () => {
  it("maps the editor's 1-based pick in the shown order back to the written one", () => {
    expect(chosenIndex(1, [1, 0])).toBe(1);
    expect(chosenIndex(2, [1, 0])).toBe(0);
  });

  it("falls back to the first shown for a pick past the list", () => {
    expect(chosenIndex(5, [2, 0, 1])).toBe(2);
  });
});

describe("choiceResponseSchema", () => {
  it("accepts only a number among those shown", () => {
    const schema = choiceResponseSchema(3);
    expect(schema.safeParse({ why: "", choice: 3 }).success).toBe(true);
    expect(schema.safeParse({ why: "", choice: 4 }).success).toBe(false);
    expect(schema.safeParse({ why: "", choice: 0 }).success).toBe(false);
  });
});
