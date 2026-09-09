import { describe, expect, it } from "vitest";
import { isPickDesign } from "./pick-mode";

describe("isPickDesign", () => {
  it("recognises the chooser's link", () => {
    expect(isPickDesign("design")).toBe(true);
  });

  it.each([undefined, "", "designs", "Design", "calendar", "true"])(
    "ignores %s",
    (value) => {
      expect(isPickDesign(value)).toBe(false);
    },
  );
});
