import { describe, expect, it } from "vitest";
import { LOGO_EVAL_CASES } from "./logo-cases";

describe("logo eval cases", () => {
  it("has unique ids", () => {
    const ids = LOGO_EVAL_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /* A case that expects a logo but specifies "none" would pass while proving
     nothing — it is the exact state the bug produced. */
  it("never expects a logo from a placement of none", () => {
    for (const testCase of LOGO_EVAL_CASES) {
      if (testCase.expectLogo) {
        expect(testCase.spec.logoPlacement).not.toBe("none");
      } else {
        expect(testCase.spec.logoPlacement).toBe("none");
      }
    }
  });

  it("covers both render routes and both mark shapes", () => {
    const routes = new Set(LOGO_EVAL_CASES.map((c) => c.route));
    const marks = new Set(LOGO_EVAL_CASES.map((c) => c.mark));
    expect(routes).toEqual(new Set(["composite", "native"]));
    expect(marks).toEqual(new Set(["square", "wordmark"]));
  });

  it("includes the logo-free inverse", () => {
    expect(LOGO_EVAL_CASES.some((c) => !c.expectLogo)).toBe(true);
  });

  /* Every paid image is money; the count belongs in the diff so a case added
     casually shows up as a cost change. */
  it("spends on exactly two images", () => {
    const paid = LOGO_EVAL_CASES.filter(
      (c) => c.route === "native" || c.withPlate,
    );
    expect(paid).toHaveLength(2);
  });
});
