import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SEQUENCE_EVAL_CASES, SEQUENCE_HELD_OUT_CASES } from "./cases";
import { OWNER_POOL } from "./owner-pool";

const PROMPT_FILE = join(
  process.cwd(),
  "src/lib/ai/prompts/design-sequence.ts",
);

/* Five words in a row is long enough to be a copied phrase, short enough
   that a fact cannot dodge the check by changing one word at its end. */
const COPIED_RUN_WORDS = 5;

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .split(/[^\p{L}\p{N}'₦$%]+/u)
    .filter(Boolean);

function copiedRuns(fact: string, haystack: string): string[] {
  const factWords = words(fact);
  const runs: string[] = [];
  for (let i = 0; i + COPIED_RUN_WORDS <= factWords.length; i++) {
    const run = factWords.slice(i, i + COPIED_RUN_WORDS).join(" ");
    if (haystack.includes(` ${run} `)) runs.push(run);
  }
  return runs;
}

const fixtureIds = [...SEQUENCE_EVAL_CASES, ...SEQUENCE_HELD_OUT_CASES].map(
  (c) => c.id,
);

describe("the owner pool for the approved-outline eval lane", () => {
  it("covers every tuning and held-out fixture, and nothing else", () => {
    expect(Object.keys(OWNER_POOL).sort()).toEqual([...fixtureIds].sort());
  });

  it.each(fixtureIds)("gives %s four to six distinct facts", (id) => {
    const pool = OWNER_POOL[id];
    expect(pool.length).toBeGreaterThanOrEqual(4);
    expect(pool.length).toBeLessThanOrEqual(6);
    expect(new Set(pool.map((f) => f.toLowerCase())).size).toBe(pool.length);
  });

  it("keeps every fact short enough for an owner to type", () => {
    const tooLong = Object.values(OWNER_POOL)
      .flat()
      .filter((f) => f.trim().length === 0 || f.length >= 120);
    expect(tooLong).toEqual([]);
  });

  it("copies no fact, and no run of five words, from the prompt file", () => {
    const prompt = readFileSync(PROMPT_FILE, "utf8");
    const haystack = ` ${words(prompt).join(" ")} `;
    const copied = Object.entries(OWNER_POOL).flatMap(([id, pool]) =>
      pool.flatMap((fact) => [
        ...(prompt.toLowerCase().includes(fact.toLowerCase())
          ? [`${id}: "${fact}"`]
          : []),
        ...copiedRuns(fact, haystack).map((run) => `${id}: "${run}"`),
      ]),
    );
    expect(copied).toEqual([]);
  });

  it("catches a fact lifted from the prompt", () => {
    const prompt = readFileSync(PROMPT_FILE, "utf8");
    const haystack = ` ${words(prompt).join(" ")} `;
    const lifted = words(prompt).slice(40, 46).join(" ");
    expect(copiedRuns(lifted, haystack)).not.toEqual([]);
  });
});
