import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildArcCopyPrompt,
  buildArcPrompt,
  buildFixPrompt,
  buildFrameRegeneratePrompt,
  buildSequenceSystemPrompt,
} from "@/lib/ai/prompts/design-sequence";
import { HOOK_CRAFT } from "@/lib/design/sequence/hook";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import { fixtureLeaks as leaks } from "./prompt-leak";

const PROMPT_FILE = join(
  process.cwd(),
  "src/lib/ai/prompts/design-sequence.ts",
);

describe("the sequence prompt never quotes an eval fixture", () => {
  it("finds fixture phrases a prompt once quoted", () => {
    expect(
      leaks(
        'a question ("Can your teen bake real sourdough?") or ("18 hours for one bottle")',
      ),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining('event: "sourdough"'),
        expect.stringContaining('cafe: "18 hours"'),
      ]),
    );
  });

  it("holds no fixture phrase in the prompt file, comments included", () => {
    expect(leaks(readFileSync(PROMPT_FILE, "utf8"))).toEqual([]);
  });

  it("holds none in the hook craft the prompt quotes", () => {
    expect(leaks(HOOK_CRAFT)).toEqual([]);
  });

  it("builds no prompt with one, for a brief that is not a fixture", () => {
    const brandSummary = {
      name: "Spoke & Chain",
      overview: "Bicycle repair workshop in Ojota",
    };
    const context = directionsContext({
      title: "Bike service week",
      briefText: "Bike servicing at our Ojota workshop. Message us to book.",
      designType: "Instagram carousel",
      brandSummary,
    });
    const beat = {
      role: "body" as const,
      title: "The service",
      headline: "Tuned while you wait",
      subheadline: "",
      cta: "",
      footerLines: [],
      layout: "hero-center" as const,
      showsImage: false,
      backgroundPrompt: "",
    };
    const frames = [
      { ...beat, role: "hook" as const },
      beat,
      { ...beat, role: "cta" as const, cta: "Message us" },
    ];
    const claimed = frames.map((f) => ({
      role: f.role,
      title: f.title,
      claim: "A point",
      facts: [],
      layout: f.layout,
      showsImage: f.showsImage,
    }));
    const built = [
      buildSequenceSystemPrompt(brandSummary, true),
      ...(["carousel", "presentation"] as const).flatMap((kind) => [
        buildArcPrompt(context, {
          kind,
          frameCount: 3,
          aspectRatio: "4:5",
          pool: [
            { source: "profile", text: "Repairs and servicing", facts: [] },
          ],
          actionFacts: [],
          offering: "bike servicing",
          imageSource: "ko",
          imageAttached: false,
        }),
        buildArcCopyPrompt(context, {
          kind,
          frames: claimed,
          offering: "bike servicing",
          imageSource: "none",
          aspectRatio: "4:5",
        }),
        buildFixPrompt(context, {
          kind,
          plan: frames,
          frames: claimed,
          fixes: [
            { index: 0, faults: ["a fault"] },
            { index: 1, faults: ["a fault"], newClaim: "Another point" },
          ],
          names: ["bike servicing"],
        }),
        buildFrameRegeneratePrompt(context, {
          kind,
          frames,
          index: 0,
          mustState: [],
          offering: "bike servicing",
        }),
      ]),
    ];
    for (const prompt of built) expect(leaks(prompt)).toEqual([]);
  });
});
