import { describe, expect, it } from "vitest";
import { balancedInset } from "./image";

/* Round-7 live critic: a 9:16 photo set from the left with 220 px blank
   beside it read as parked. */
describe("balancedInset", () => {
  const region = { x: 86, y: 86, width: 908, height: 849 };
  const parked = {
    frame: { x: 86, y: 86, width: 600, height: 849 },
    fit: "cover" as const,
    zoom: 1,
    focusX: 0.5,
    focusY: 0.5,
  };

  it("centres a print that would leave a blank side", () => {
    const out = balancedInset(parked, region, [], "start");
    expect(out.frame.x).toBe(86 + (908 - 600) / 2);
  });

  it("keeps it lined up when the middle holds the logo", () => {
    const logo = { x: 400, y: 100, width: 100, height: 60 };
    expect(balancedInset(parked, region, [logo], "start")).toBe(parked);
  });

  it("keeps a print that nearly fills its band where it is", () => {
    const wide = { ...parked, frame: { ...parked.frame, width: 860 } };
    expect(balancedInset(wide, region, [], "start")).toBe(wide);
  });
});
