import { describe, expect, it } from "vitest";
import type { DesignSpec } from "@/lib/design/spec";
import type { DesignSpecEvalCase } from "./cases";
import {
  aggregateDesignSpec,
  designSpecPassed,
  scoreDesignSpecCase,
} from "./score";

const THRESHOLDS = {
  minValidHex: 1,
  minBrandColorUse: 0.8,
  minContrastOk: 0.75,
};

function testCase(over: Partial<DesignSpecEvalCase> = {}): DesignSpecEvalCase {
  return {
    id: "c1",
    brand: { name: "B" },
    request: {
      title: "t",
      designType: "Instagram Post",
      dimensions: "1080x1350",
      platform: "Instagram",
      aspectRatio: "4:5",
      briefText: "b",
    },
    brandHexes: ["#0F172A", "#F97316"],
    ...over,
  };
}

function spec(palette: DesignSpec["palette"]): DesignSpec {
  return { palette } as DesignSpec;
}

describe("scoreDesignSpecCase", () => {
  it("credits a palette that uses a stated brand colour", () => {
    const s = scoreDesignSpecCase(
      testCase(),
      spec({
        background: "#0F172A",
        foreground: "#FFFFFF",
        accent: "#F97316",
      }),
    );
    expect(s.usesBrandColor).toBe(true);
    expect(s.validHex).toBe(true);
    expect(s.contrastOk).toBe(true);
  });

  it("fails a palette that ignores the brand entirely", () => {
    const s = scoreDesignSpecCase(
      testCase(),
      spec({
        background: "#123456",
        foreground: "#FFFFFF",
        accent: "#ABCDEF",
      }),
    );
    expect(s.usesBrandColor).toBe(false);
  });

  it("matches brand colours case- and shorthand-insensitively", () => {
    const s = scoreDesignSpecCase(
      testCase({ brandHexes: ["#ffffff"] }),
      spec({ background: "#fff", foreground: "#000000", accent: "#111111" }),
    );
    expect(s.usesBrandColor).toBe(true);
  });

  /* A brand that states no hexes must be excluded, not scored zero — the
     prompt explicitly tells the model to invent a palette in that case. */
  it("excludes a brand with no stated hexes rather than failing it", () => {
    const s = scoreDesignSpecCase(
      testCase({ brandHexes: [] }),
      spec({ background: "#123456", foreground: "#FFFFFF", accent: "#ABCDEF" }),
    );
    expect(s.usesBrandColor).toBeNull();
  });

  it("flags a non-hex slot", () => {
    const s = scoreDesignSpecCase(
      testCase(),
      spec({
        background: "forest green",
        foreground: "#FFF",
        accent: "#F97316",
      }),
    );
    expect(s.validHex).toBe(false);
  });

  it("fails an unreadable foreground/background pair", () => {
    const s = scoreDesignSpecCase(
      testCase(),
      spec({ background: "#0F172A", foreground: "#111827", accent: "#F97316" }),
    );
    expect(s.contrastOk).toBe(false);
  });

  it("credits a named colour converted into the right hue", () => {
    const s = scoreDesignSpecCase(
      testCase({ brandHexes: [], expectedHue: "green" }),
      spec({ background: "#14532D", foreground: "#FFFFFF", accent: "#86EFAC" }),
    );
    expect(s.honorsNamedColor).toBe(true);
  });

  it("catches a named colour converted into the wrong hue", () => {
    const s = scoreDesignSpecCase(
      testCase({ brandHexes: [], expectedHue: "green" }),
      spec({ background: "#7C2D12", foreground: "#FFFFFF", accent: "#B91C1C" }),
    );
    expect(s.honorsNamedColor).toBe(false);
  });

  it("does not read a hue from a greyscale slot", () => {
    const s = scoreDesignSpecCase(
      testCase({ brandHexes: [], expectedHue: "green" }),
      spec({ background: "#333333", foreground: "#FFFFFF", accent: "#000000" }),
    );
    expect(s.honorsNamedColor).toBe(false);
  });
});

describe("aggregateDesignSpec", () => {
  const good = scoreDesignSpecCase(
    testCase(),
    spec({ background: "#0F172A", foreground: "#FFFFFF", accent: "#F97316" }),
  );
  const noBrandHexes = scoreDesignSpecCase(
    testCase({ id: "c2", brandHexes: [] }),
    spec({ background: "#000000", foreground: "#FFFFFF", accent: "#ABCDEF" }),
  );

  it("ignores excluded cases when averaging brand-colour use", () => {
    const totals = aggregateDesignSpec([good, noBrandHexes]);
    expect(totals.brandColorUse).toBe(1);
    expect(designSpecPassed(totals, THRESHOLDS)).toBe(true);
  });

  it("reports a full pass as passing", () => {
    expect(designSpecPassed(aggregateDesignSpec([good]), THRESHOLDS)).toBe(
      true,
    );
  });

  it("fails the run when a named colour is missed", () => {
    const missed = scoreDesignSpecCase(
      testCase({ id: "c3", brandHexes: [], expectedHue: "green" }),
      spec({ background: "#7C2D12", foreground: "#FFFFFF", accent: "#B91C1C" }),
    );
    const totals = aggregateDesignSpec([good, missed]);
    expect(totals.namedColorMisses).toEqual(["c3"]);
    expect(designSpecPassed(totals, THRESHOLDS)).toBe(false);
  });

  it("fails the run when any slot is not a hex", () => {
    const bad = scoreDesignSpecCase(
      testCase({ id: "c4" }),
      spec({ background: "rgb(1,2,3)", foreground: "#FFF", accent: "#F97316" }),
    );
    expect(designSpecPassed(aggregateDesignSpec([good, bad]), THRESHOLDS)).toBe(
      false,
    );
  });
});
