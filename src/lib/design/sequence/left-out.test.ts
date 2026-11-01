import { describe, expect, it } from "vitest";
import { beatOf } from "./fixtures";
import { namesFree } from "./hook";
import { whereItLives } from "./left-out";

/* Integration round 2, HIGH 1: a frame dropped after its line went onto
   the hook was reported as one code "couldn't word". */
describe("whereItLives", () => {
  const free = namesFree("Lumen Coffee", "Lumen Cold Brew");
  const frames = [
    beatOf({
      role: "hook",
      headline: "Steeped 20 hours, so every sip stays smooth",
      subheadline: "Lumen Cold Brew pours low in acid.",
    }),
    beatOf({
      headline: "Buy two, get a free pastry",
      subheadline: "The pastry comes free on launch day only.",
    }),
    beatOf({ role: "cta", headline: "Order ahead on WhatsApp" }),
  ];

  it("says a frame lifted onto the hook is on slide 1", () => {
    expect(whereItLives(frames, true, "anything", free)).toEqual({
      reason: "merged",
      keptOn: 0,
    });
  });

  it("names the one frame that still makes the point", () => {
    expect(
      whereItLives(frames, false, "Buy two, get a free pastry", free),
    ).toEqual({ reason: "merged", keptOn: 1 });
  });

  it("is a fault only when the set no longer makes the point", () => {
    expect(
      whereItLives(
        frames,
        false,
        "Brewed with single-origin Ethiopian beans",
        free,
      ),
    ).toEqual({ reason: "fault" });
    expect(whereItLives(frames, false, "", free)).toEqual({ reason: "fault" });
  });
});
