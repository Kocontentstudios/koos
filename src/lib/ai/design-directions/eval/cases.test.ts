import { describe, expect, it } from "vitest";
import {
  brandRegion,
  phoneRegions,
  settleBriefFacts,
} from "@/lib/jobs/directions/brief-facts";
import { DIRECTIONS_EVAL_CASES } from "./cases";
import { labelKind } from "./read-score";

/* Coverage is measured against these labels, so a label the brief does not
   hold would drop out of the denominator silently and lift the score. */
describe("every eval case's labels are the brief's own words", () => {
  it.each(
    DIRECTIONS_EVAL_CASES.filter((c) => c.facts.length > 0).map(
      (c) => [c.id, c] as const,
    ),
  )("%s", (_id, evalCase) => {
    const brief = evalCase.request.briefText;
    const required = evalCase.facts.filter((f) => !f.optional);
    const { facts, dropped } = settleBriefFacts(
      required.map((f) => ({ kind: labelKind(f.text), text: f.text })),
      brief,
      {
        region: phoneRegions(
          brief,
          brandRegion([evalCase.brand.overview, evalCase.brand.name]),
        ),
      },
    );
    expect(dropped).toEqual([]);
    expect(facts).toHaveLength(required.length);
    for (const name of evalCase.people ?? []) {
      expect(brief).toContain(name);
    }
  });

  /* Round-8c orchestrator ruling: a label must be a phrase the brief
     states. "aso-oke throws" was not, and failed the coverage gate on
     copy that stated the brief's "autumn aso-oke collection". */
  it.each(DIRECTIONS_EVAL_CASES.map((c) => [c.id, c] as const))(
    "%s: every fact, product and person label is in the brief word for word",
    (_id, evalCase) => {
      const brief = evalCase.request.briefText.toLowerCase();
      const labels = [
        ...evalCase.facts.map((f) => f.text),
        ...(evalCase.product ? [evalCase.product] : []),
        ...(evalCase.people ?? []),
      ];
      for (const label of labels) {
        expect(brief, label).toContain(label.toLowerCase());
      }
    },
  );

  it("copies no critic's live brief: the round-6 cases are held out", () => {
    const ids = DIRECTIONS_EVAL_CASES.map((c) => c.id);
    for (const copied of [
      "cups-photo-upload",
      "coat-portrait-upload",
      "sourdough-class-ko",
    ]) {
      expect(ids).not.toContain(copied);
    }
    expect(ids).toEqual(
      expect.arrayContaining([
        "kimono-wide-upload",
        "tutoring-ko",
        "pottery-evening-ko",
        "storefront-reopening-upload",
        "retreat-sky-upload",
      ]),
    );
  });
});
