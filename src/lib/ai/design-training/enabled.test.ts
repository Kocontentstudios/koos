import { afterEach, describe, expect, it, vi } from "vitest";
import { designTrainingEnabled } from "./enabled";

/* KOOS-AI-001 §1.7. The benchmark has to run the same brief with and without
   the training system, and the only honest way to do that in one process is a
   real switch. It doubles as the rollback: if the training system makes output
   worse in production, this turns it off without a deploy. */
describe("designTrainingEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /* On by default. A flag that silently defaults to off would let the feature
     look shipped while doing nothing — the exact failure the approach doc
     warns about. */
  it("is on when nothing is configured", () => {
    vi.stubEnv("AI_DESIGN_TRAINING", "");
    expect(designTrainingEnabled()).toBe(true);
  });

  it.each(["off", "OFF", "false", "0", "no"])("is off for %s", (value) => {
    vi.stubEnv("AI_DESIGN_TRAINING", value);
    expect(designTrainingEnabled()).toBe(false);
  });

  it.each(["on", "true", "1", "yes", "anything else"])(
    "stays on for %s",
    (value) => {
      vi.stubEnv("AI_DESIGN_TRAINING", value);
      expect(designTrainingEnabled()).toBe(true);
    },
  );

  /* The benchmark runs both arms in one process, so the caller must be able to
     override the environment per call. */
  it("takes an explicit override over the environment", () => {
    vi.stubEnv("AI_DESIGN_TRAINING", "off");
    expect(designTrainingEnabled(true)).toBe(true);

    vi.stubEnv("AI_DESIGN_TRAINING", "on");
    expect(designTrainingEnabled(false)).toBe(false);
  });
});
