// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  designOfRuns,
  designWith,
  EMOJI_SHAPES,
  LOOSE_PIECES,
  SEPARATORS,
} from "./emoji-shapes";
import { type DesignDocument, designDocumentSchema } from "./schema";
import { MAX_EMOJI_PER_DOCUMENT } from "./text-safety";

/**
 * The per-design emoji cap, shape by shape.
 *
 * next/og fetches one picture per distinct emoji grapheme, so the cap holds
 * when 24 distinct clusters of any shape parse and 25 are refused, however
 * they are spread over the runs and whatever separates them.
 * emoji-fetch.smoke.test.ts checks the same designs against next/og itself.
 */

const parses = (doc: DesignDocument) =>
  designDocumentSchema.safeParse(doc).success;

describe("every emoji shape counts one per distinct cluster", () => {
  const cases = Object.entries(EMOJI_SHAPES).flatMap(([shape, clusters]) =>
    SEPARATORS.map(
      (separator) =>
        [shape, JSON.stringify(separator), clusters, separator] as const,
    ),
  );

  it.each(cases)("%s, separated by %s", (_, __, clusters, separator) => {
    expect(new Set(clusters).size).toBeGreaterThan(MAX_EMOJI_PER_DOCUMENT);
    expect(
      parses(designWith(clusters.slice(0, MAX_EMOJI_PER_DOCUMENT), separator)),
    ).toBe(true);
    expect(
      parses(
        designWith(clusters.slice(0, MAX_EMOJI_PER_DOCUMENT + 1), separator),
      ),
    ).toBe(false);
  });
});

describe("no loose piece of an emoji reaches the renderer", () => {
  /* After each kind of break, and at the start of every run, behind an emoji
     in the run before: satori would join it to that emoji. */
  const places: [string, (piece: string) => string[]][] = [
    ["after a newline", (piece) => ["👍", `a\n${piece}`]],
    ["after a return", (piece) => ["👍", `a\r${piece}`]],
    ["after a return and newline", (piece) => ["👍", `a\r\n${piece}`]],
    ...Array.from(
      { length: 7 },
      (_, run): [string, (piece: string) => string[]] => [
        `at the start of run ${run + 2}`,
        (piece) => [...Array.from({ length: run }, () => "a"), "👍", piece],
      ],
    ),
  ];

  const cases = Object.entries(LOOSE_PIECES).flatMap(([name, piece]) =>
    places.map(([where, build]) => [name, where, build(piece), piece] as const),
  );

  it.each(cases)("%s %s", (_, __, runs, piece) => {
    const parsed = designDocumentSchema.safeParse(designOfRuns(runs));
    if (!parsed.success) return;
    /* Normalising may remove a piece that draws nothing; it must not be
       stored where it could attach to a neighbour. */
    for (const element of parsed.data.elements) {
      if (element.type === "text") expect(element.text).not.toContain(piece);
    }
  });
});
