import { describe, expect, it } from "vitest";
import { monospaceMeasurer, PALETTE, REALISTIC, specFor } from "../fixtures";
import { COPY_SHRUNK, COPY_TOO_LONG } from "../from-spec";
import type { Context } from "./context";
import { rect } from "./context";
import { COMPACT_SCALE, copyStack, placeStack } from "./copy-stack";
import { flatColors } from "./shared";

/* A 1:1 card whose subject leaves the copy a short zone. At natural
   proportions the headline stepped below its scale while the 160px quote
   mark and the full-size button kept theirs, so a 21px headline sat under a
   mark eight times its size. */
function context(): Context {
  return {
    spec: specFor("quote-card", "1:1", REALISTIC),
    palette: PALETTE,
    width: 1080,
    height: 1080,
    ref: 1080,
    margin: 86,
    image: null,
    imageFacts: null,
    subject: null,
    logo: null,
    logoBox: null,
    measurer: monospaceMeasurer(),
    faults: new Set(),
    subjectFaults: new Set(),
    smallFooter: false,
  };
}

async function sizes(zoneHeight: number) {
  const ctx = context();
  const stack = await copyStack(ctx, {
    zone: rect(130, 500, 820, zoneHeight),
    align: "center",
    vAlign: "end",
    colors: flatColors(ctx),
    quoteMark: true,
  });
  const elements = await placeStack(stack);
  const size = (id: string) => {
    const element = elements.find((e) => e.id === id);
    return element?.type === "text" || element?.type === "button"
      ? element.fontSize
      : 0;
  };
  return {
    stack,
    headline: size("headline"),
    subheadline: size("subheadline"),
    cta: size("cta"),
    quote: size("quote-mark"),
  };
}

describe("copyStack in a short zone", () => {
  it("keeps natural proportions when the copy fits its scale", async () => {
    const roomy = await sizes(900);
    expect(roomy.stack.faults).not.toContain(COPY_SHRUNK);
    expect(roomy.quote).toBe(Math.round(1080 * 0.15));
  });

  it("shrinks the quote mark and button before the headline", async () => {
    const tight = await sizes(380);
    expect(tight.stack.faults).not.toContain(COPY_TOO_LONG);
    expect(tight.quote).toBe(Math.round(1080 * 0.15 * COMPACT_SCALE));
    expect(tight.headline).toBeGreaterThan(tight.subheadline);
    expect(tight.headline).toBeGreaterThan(tight.cta);
  });
});
