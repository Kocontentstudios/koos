import { describe, expect, it } from "vitest";
import type { DesignFault } from "./checks";
import { betterResult, faultSummary, isCorrectable, isRetryable } from "./gate";

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

/* The two sets used to be one, and the consequence was that the only faults
   reaching a second render were the two with nothing to look at: unreadable
   bytes hold no image, and a blank frame is a flat rectangle the deterministic
   check has already described. The judge's vision half was unreachable. */
describe("isCorrectable", () => {
  it.each(["blank-frame", "unreadable-image", "unreadable-logo"] as const)(
    "lets a changed spec answer %s",
    (code) => {
      expect(isCorrectable([fault(code)])).toBe(true);
    },
  );

  /* The case the split exists for: re-rolling the same spec cannot change a
     mark's contrast against its own ground, but moving the corner, lifting the
     colour behind it or dropping the footer band that swallowed it all can. */
  it("treats an unreadable logo as correctable but not re-rollable", () => {
    expect(isCorrectable([fault("unreadable-logo")])).toBe(true);
    expect(isRetryable([fault("unreadable-logo")])).toBe(false);
  });

  /* Adapters substitute aspect ratios deterministically, so no change to the
     spec alters what comes back and a judge call would buy a verdict nobody
     can act on. */
  it("leaves the wrong shape out of both", () => {
    expect(isCorrectable([fault("wrong-dimensions")])).toBe(false);
    expect(isRetryable([fault("wrong-dimensions")])).toBe(false);
  });

  it("is false for no faults at all, so a clean design costs nothing", () => {
    expect(isCorrectable([])).toBe(false);
  });
});

/* A count alone made a blank rectangle and a real design with one hard-to-read
   mark equally bad, so the correction that produced the real design was
   discarded and the empty frame delivered. The path is reachable: a blank
   first render, a backgroundPrompt correction, and a second render whose only
   remaining fault is the logo. */
describe("betterResult ranks by severity before count", () => {
  const result = (...codes: DesignFault["code"][]) => ({
    ok: false,
    failures: codes.map(fault),
  });

  it("prefers a real design with an unreadable mark over a blank frame", () => {
    expect(betterResult(result("blank-frame"), result("unreadable-logo"))).toBe(
      "second",
    );
    expect(betterResult(result("unreadable-logo"), result("blank-frame"))).toBe(
      "first",
    );
  });

  it("prefers the wrong shape over nothing to look at", () => {
    expect(
      betterResult(result("unreadable-image"), result("wrong-dimensions")),
    ).toBe("second");
  });

  /* Two faults of the same worst kind fall back to the count, which is what
     the original rule did and still the right tie-break. */
  it("falls back to the count at equal severity", () => {
    expect(
      betterResult(
        result("blank-frame", "unreadable-logo"),
        result("blank-frame"),
      ),
    ).toBe("second");
  });

  it("keeps the first on a true tie", () => {
    expect(betterResult(result("blank-frame"), result("blank-frame"))).toBe(
      "first",
    );
  });
});
