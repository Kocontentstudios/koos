import { describe, expect, it } from "vitest";
import {
  gradedIndex,
  gradeResponseSchema,
  gradesByIndex,
  leastProblems,
  notesByIndex,
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

describe("graded choice", () => {
  const answer = gradeResponseSchema(3).parse({
    grades: [
      { version: 1, repeats: "none", hook: 3, builds: 3, action: 5 },
      {
        version: 2,
        repeats: "2 and 3: both say it is made by hand",
        hook: 5,
        builds: 4,
        action: 5,
      },
      { version: 3, repeats: "None found.", hook: 2, builds: 2, action: 4 },
    ],
  });
  /* Shown in the order 2, 0, 1 of the written versions. */
  const order = [2, 0, 1];

  it("maps each grade and note back to the version as written", () => {
    expect(gradesByIndex(answer, order)).toEqual([14, 8, 11]);
    expect(notesByIndex(answer, order)).toEqual([
      "2 and 3: both say it is made by hand",
      null,
      null,
    ]);
  });

  it("grades only the versions with the fewest hard problems", () => {
    expect(gradedIndex([0, 0, 0], [5, 0, 0], [14, 8, 11])).toBe(0);
    expect(gradedIndex([3, 0, 0], [0, 5, 5], [14, 8, 11])).toBe(2);
  });

  it("breaks a tie, or a version left ungraded, on code's copy faults", () => {
    expect(gradedIndex([0, 0], [4, 1], [12, 12])).toBe(1);
    expect(gradedIndex([0, 0], [4, 1], [null, null])).toBe(1);
    expect(gradedIndex([0, 0], [1, 1], [null, 9])).toBe(1);
  });

  it("refuses an answer that grades a version out of range", () => {
    expect(() =>
      gradeResponseSchema(1).parse({
        grades: [
          { version: 1, repeats: "none", hook: 6, builds: 3, action: 3 },
        ],
      }),
    ).toThrow();
  });
});
