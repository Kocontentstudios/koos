import { describe, expect, it } from "vitest";
import type { DesignFault } from "./checks";
import { betterResult, faultSummary, isRetryable } from "./gate";

const fault = (code: DesignFault["code"]): DesignFault => ({
  code,
  detail: `detail for ${code}`,
});

/* KOOS-AI-001 §1.6, with Oluwaseyi's answer: one correction pass, not a loop.
   A loop can spin forever on a brief that cannot be satisfied; one pass is
   bounded and predictable. Which faults earn that one pass is the question
   this answers. */
describe("isRetryable", () => {
  /* A blank plate is the image model having refused or returned nothing. The
     next roll is a different plate, so it is worth exactly one more try. */
  it.each(["blank-frame", "unreadable-image"] as const)(
    "retries %s, because a fresh render can come back different",
    (code) => {
      expect(isRetryable([fault(code)])).toBe(true);
    },
  );

  /* The mark's legibility is measured from its own geometry and contrast, and
     the product already answers it: keep the design, tell the user which mark
     to replace. Re-rolling would double the cost of every such design and
     still deliver the same unreadable mark. */
  it("does not retry an unreadable logo, which the product already handles", () => {
    expect(isRetryable([fault("unreadable-logo")])).toBe(false);
  });

  /* The adapters substitute aspect ratios deterministically — Google serves
     3:4 where 4:5 was asked for, every time. Re-rolling buys nothing and costs
     the user another wait and another image. */
  it("does not retry the wrong shape, which a re-roll cannot change", () => {
    expect(isRetryable([fault("wrong-dimensions")])).toBe(false);
  });

  it("retries when any fault is worth retrying", () => {
    expect(isRetryable([fault("wrong-dimensions"), fault("blank-frame")])).toBe(
      true,
    );
  });

  it("has nothing to retry when the design passed", () => {
    expect(isRetryable([])).toBe(false);
  });
});

describe("betterResult", () => {
  const clean = { ok: true, failures: [] };
  const oneFault = { ok: false, failures: [fault("blank-frame")] };
  const twoFaults = {
    ok: false,
    failures: [fault("blank-frame"), fault("unreadable-logo")],
  };

  it("prefers the attempt that passed", () => {
    expect(betterResult(oneFault, clean)).toBe("second");
    expect(betterResult(clean, oneFault)).toBe("first");
  });

  it("prefers fewer faults when neither passed", () => {
    expect(betterResult(twoFaults, oneFault)).toBe("second");
  });

  /* A retry that is no better keeps the original: swapping for an equally bad
     second attempt wastes the correction and changes what the user sees for
     no reason. */
  it("keeps the first attempt when the retry is no better", () => {
    expect(betterResult(oneFault, oneFault)).toBe("first");
    expect(betterResult(clean, clean)).toBe("first");
  });
});

describe("faultSummary", () => {
  it("says what went wrong in words, for the user and the log", () => {
    const summary = faultSummary([
      fault("blank-frame"),
      fault("unreadable-logo"),
    ]);

    expect(summary).toContain("detail for blank-frame");
    expect(summary).toContain("detail for unreadable-logo");
  });

  it("is empty when nothing went wrong", () => {
    expect(faultSummary([])).toBe("");
  });
});
