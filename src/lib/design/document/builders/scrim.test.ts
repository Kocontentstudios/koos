import { describe, expect, it } from "vitest";
import {
  alphaAt,
  isLargeType,
  MIN_RAMP,
  profileStops,
  SLOPE_MAX,
  type Stop,
} from "./scrim";

/** What a CSS gradient draws at `u`. */
const drawnAt = alphaAt;

/** Where the drawn veil first leaves zero and first reaches its peak,
 *  extending the first segment back past the box edge when it starts
 *  already veiled. */
function rampSpan(stops: Stop[]): number {
  const peak = Math.max(...stops.map((s) => s.alpha));
  const reached = stops.find((s) => s.alpha >= peak - 1e-9)?.at ?? 0;
  const lastZero = [...stops].reverse().find((s) => s.alpha === 0);
  if (lastZero) return reached - lastZero.at;
  const [a, b] = stops;
  const slope = (b.alpha - a.alpha) / (b.at - a.at);
  return reached - (a.at - a.alpha / slope);
}

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

describe("profileStops", () => {
  it("draws nothing when no copy needs a veil", () => {
    expect(profileStops([])).toEqual([]);
    expect(profileStops([{ at: 0.4, alpha: 0 }])).toEqual([]);
  });

  /* Round 4, hero-center 9:16 portrait: the subject ended where the copy
     began, the ramp had no room, and four stops landed on 50.3%. */
  it("never stacks stops at one position", () => {
    for (const at of [0, 0.03, 0.503, 0.97, 1]) {
      const stops = profileStops([{ at, alpha: 0.45 }]);
      for (let i = 1; i < stops.length; i += 1) {
        expect(stops[i].at).toBeGreaterThan(stops[i - 1].at);
      }
    }
  });

  /* Round 4, hero-center 1:1 sky: 0 to 0.55 over 17% of the height. */
  it("takes at least MIN_RAMP to reach its peak, and never rises faster than SLOPE_MAX", () => {
    const stops = profileStops([{ at: 0.19, alpha: 0.55 }]);
    expect(rampSpan(stops)).toBeGreaterThanOrEqual(MIN_RAMP - 1e-9);
    for (let i = 1; i < stops.length; i += 1) {
      const slope =
        (stops[i].alpha - stops[i - 1].alpha) / (stops[i].at - stops[i - 1].at);
      expect(slope).toBeLessThanOrEqual(
        Math.max(SLOPE_MAX, 0.55 / MIN_RAMP) + 1e-9,
      );
    }
  });

  it("veils a large headline lightly and the smaller copy below it fully", () => {
    const stops = profileStops([
      { at: 0.25, alpha: 0.3 },
      { at: 0.6, alpha: 0.55 },
    ]);
    expect(drawnAt(stops, 0.25)).toBeGreaterThanOrEqual(0.3);
    expect(drawnAt(stops, 0.25)).toBeLessThan(0.45);
    expect(drawnAt(stops, 0.6)).toBeGreaterThanOrEqual(0.55);
  });

  it("drops a need an earlier, heavier one already covers", () => {
    const stops = profileStops([
      { at: 0.4, alpha: 0.5 },
      { at: 0.7, alpha: 0.2 },
    ]);
    expect(stops.map((s) => s.at)).not.toContain(0.7);
  });

  /* The guarantee the contrast rests on, over random copy: wherever a run
     of copy starts, and everywhere after it, the drawn veil is at least
     what that run needs. */
  it("meets every need, rises monotonically and fits the schema's five stops", () => {
    const random = seeded(7);
    for (let trial = 0; trial < 2000; trial += 1) {
      const needs = Array.from(
        { length: 1 + Math.floor(random() * 5) },
        () => ({
          at: Math.round((random() * 1.2 - 0.1) * 1000) / 1000,
          alpha: Math.round(random() * 100) / 100,
        }),
      );
      const stops = profileStops(needs);
      if (
        needs.every((n) => n.alpha < 0.02) ||
        Math.max(...needs.map((n) => n.alpha)) < 0.02
      ) {
        expect(stops).toEqual([]);
        continue;
      }
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(stops.length).toBeLessThanOrEqual(5);
      for (let i = 1; i < stops.length; i += 1) {
        expect(stops[i].alpha).toBeGreaterThanOrEqual(
          stops[i - 1].alpha - 1e-9,
        );
      }
      for (const need of needs) {
        for (let u = Math.max(0, need.at); u <= 1; u += 0.01) {
          expect(drawnAt(stops, u)).toBeGreaterThanOrEqual(need.alpha - 1e-9);
        }
      }
    }
  });
});

describe("isLargeType", () => {
  it.each([
    [48, 400, true],
    [47, 400, false],
    [37, 700, true],
    [37, 600, false],
    [36, 700, false],
  ] as const)("%ipx at %i is large: %s", (fontSize, fontWeight, large) => {
    expect(isLargeType({ fontSize, fontWeight })).toBe(large);
  });
});
