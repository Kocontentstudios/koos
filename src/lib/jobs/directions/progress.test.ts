import { describe, expect, it, vi } from "vitest";
import { renderConcurrency } from "./concurrency";
import { createStageReporter } from "./progress";

describe("createStageReporter", () => {
  it("reports each stage with the direction count as total", () => {
    const report = vi.fn();
    const stage = createStageReporter(report, 2);
    stage("brief", 0, "Writing two directions…");
    expect(report).toHaveBeenCalledWith({
      stage: "brief",
      done: 0,
      total: 2,
      label: "Writing two directions…",
    });
  });

  it("never steps back to an earlier stage", () => {
    const report = vi.fn();
    const stage = createStageReporter(report, 2);
    stage("render", 2, "Rendered 2 of 2");
    stage("checks", 0, "Checking");
    stage("render", 2, "late render report");
    expect(report.mock.calls.map(([p]) => p.stage)).toEqual([
      "render",
      "checks",
    ]);
  });

  it("never lowers done within a stage", () => {
    const report = vi.fn();
    const stage = createStageReporter(report, 2);
    stage("render", 2, "two");
    stage("render", 1, "one, late");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("resets done when a stage begins", () => {
    const report = vi.fn();
    const stage = createStageReporter(report, 2);
    stage("imagery", 2, "plates");
    stage("render", 0, "rendering");
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({ stage: "render", done: 0 }),
    );
  });
});

describe("renderConcurrency", () => {
  const GB = 1024 ** 3;

  it("renders both at once when memory holds two renders", () => {
    expect(
      renderConcurrency({
        directions: 2,
        freeBytes: 2 * GB,
        imagePixels: 2560 * 2560,
      }),
    ).toBe(2);
  });

  it("renders one at a time when only one fits", () => {
    expect(
      renderConcurrency({
        directions: 2,
        freeBytes: 0.5 * GB,
        imagePixels: 4096 * 4096,
      }),
    ).toBe(1);
  });

  it("never goes below one, and never above the direction count", () => {
    expect(
      renderConcurrency({ directions: 2, freeBytes: 0, imagePixels: 0 }),
    ).toBe(1);
    expect(
      renderConcurrency({ directions: 1, freeBytes: 64 * GB, imagePixels: 0 }),
    ).toBe(1);
  });
});
