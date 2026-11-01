import { describe, expect, it } from "vitest";
import { auditFlags } from "./audit";
import { flaggedFaults } from "./faults";
import { beatOf } from "./fixtures";

const frames = [
  beatOf({ role: "hook", headline: "Solar cold rooms for Kano" }),
  beatOf({
    headline: "91% full last harvest",
    subheadline: "Demand filled almost every crate we had.",
  }),
  beatOf({ role: "cta", headline: "Email the founders" }),
];

describe("auditFlags: a subheadline the reader hears as its headline again", () => {
  it("holds a middle frame's subheadline to the reading it was flagged on", () => {
    const flags = auditFlags(
      { repeats: [], unsourced: [], restated: [2, 1, 3] },
      frames,
      "",
    );
    expect(flags).toEqual([
      {
        kind: "restated",
        frame: 1,
        subheadline: "Demand filled almost every crate we had.",
      },
    ]);
    expect(flaggedFaults(frames, flags).map((f) => f.field)).toEqual([
      "subheadline",
    ]);
    const rewritten = frames.map((b, i) =>
      i === 1
        ? { ...b, subheadline: "Farmers rented 273 of 300 crates in March." }
        : b,
    );
    expect(flaggedFaults(rewritten, flags)).toEqual([]);
  });

  it("reads an audit answer without the field as none", () => {
    expect(auditFlags({ repeats: [], unsourced: [] }, frames, "")).toEqual([]);
  });
});
