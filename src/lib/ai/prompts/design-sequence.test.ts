import { describe, expect, it } from "vitest";
import {
  CAFE_BRIEF,
  CAFE_FACTS,
  cafePlan,
} from "@/lib/design/sequence/fixtures";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import {
  buildFrameCopyPrompt,
  buildFrameRegeneratePrompt,
  buildHookChoicePrompt,
  buildHookRewritePrompt,
  buildOutlinePrompt,
  buildSequenceChoicePrompt,
  buildSequenceRepairPrompt,
  buildSequenceSystemPrompt,
  factList,
  HOOK_VERSIONS,
  hookNames,
  REGENERATE_VERSIONS,
} from "./design-sequence";

const context = directionsContext({
  title: "Cold brew launch",
  briefText: CAFE_BRIEF,
  designType: "Instagram carousel",
});

const outlineInput = {
  kind: "carousel" as const,
  frameCount: 5,
  aspectRatio: "4:5",
  facts: CAFE_FACTS,
  offering: "cold brew",
  imageSource: "ko" as const,
  imageAttached: false,
};

describe("buildSequenceSystemPrompt", () => {
  it("adds module 10's pack rules to the single-spec art director", () => {
    const system = buildSequenceSystemPrompt(
      { name: "Kiln Coffee", primaryColor: "#1F2A24" },
      true,
    );
    expect(system).toContain(
      "You are an art director producing a design for Kiln Coffee",
    );
    expect(system).toContain("#1F2A24");
    expect(system).toContain("The first frame earns the swipe");
    expect(system).toContain(
      "Every middle frame carries one point, and only one",
    );
    expect(system).toContain("The last frame carries the action");
    expect(system).toContain(
      "one palette, one type system, one logo position, one footer system",
    );
    expect(system).toContain("Neighbouring frames never share a layout");
  });
});

describe("buildOutlinePrompt", () => {
  it("asks for the arc before any copy, with every fact numbered", () => {
    const prompt = buildOutlinePrompt(context, outlineInput);
    expect(prompt).toContain(
      "exactly 5 frames, in order. Do not write any copy yet.",
    );
    expect(prompt).toContain('Frame 1 is the hook: it is about "cold brew"');
    expect(prompt).toContain('2. (price) "₦2,500 a bottle"');
    expect(prompt).toContain("Every one is carried by exactly one frame");
    expect(prompt).toContain(`Brief:\n${CAFE_BRIEF}`);
    expect(prompt).toContain("Category:");
    expect(prompt).toContain("Target aspect ratio: 4:5");
  });

  it("says when a brief has no facts, so none are invented", () => {
    const prompt = buildOutlinePrompt(context, { ...outlineInput, facts: [] });
    expect(prompt).toContain("The brief gives no hard facts");
  });

  it("briefs a presentation as a deck, never as one title slide", () => {
    const prompt = buildOutlinePrompt(context, {
      ...outlineInput,
      kind: "presentation",
      aspectRatio: "16:9",
    });
    expect(prompt).toContain("Deliverable format: presentation. A deck");
    expect(prompt).not.toContain("single title slide");
    expect(prompt).toContain("exactly 5 slides");
    expect(prompt).toContain("headline to 10 words");
  });

  it("names the repeated points on a second ask", () => {
    const prompt = buildOutlinePrompt(context, {
      ...outlineInput,
      repeated: ["A bottle costs ₦2,500"],
    });
    expect(prompt).toContain(
      'made the same point twice: "A bottle costs ₦2,500"',
    );
  });

  it("tells the planner what each image source allows", () => {
    expect(
      buildOutlinePrompt(context, { ...outlineInput, imageSource: "none" }),
    ).toContain("there is no image");
    expect(
      buildOutlinePrompt(context, {
        ...outlineInput,
        imageSource: "upload",
        imageAttached: true,
      }),
    ).toContain("The photograph is attached");
  });
});

describe("buildFrameCopyPrompt", () => {
  it("writes to the outline: each frame's role, point and facts", () => {
    const prompt = buildFrameCopyPrompt(context, {
      kind: "carousel",
      offering: "cold brew",
      imageSource: "ko",
      aspectRatio: "4:5",
      frames: [
        {
          role: "hook",
          title: "The launch",
          point: "It is here",
          facts: ["cold brew"],
          layout: "banner-bottom",
          showsImage: true,
        },
        {
          role: "cta",
          title: "Reserve",
          point: "Message us",
          facts: ["WhatsApp 0803 555 0142"],
          layout: "quote-card",
          showsImage: false,
        },
      ],
    });
    expect(prompt).toContain("frame 1 (HOOK: earns the swipe");
    expect(prompt).toContain("frame 2 (ACTION:");
    expect(prompt).toContain(
      'must state, in these words: "WhatsApp 0803 555 0142"',
    );
    expect(prompt).toContain("layout: quote-card, text-led, no image");
    expect(prompt).toContain('"headline": at most 7 words');
    expect(prompt).toContain("Only the brief's facts");
  });
});

describe("buildSequenceRepairPrompt", () => {
  it("lists the set, then only the frames to fix with their problems", () => {
    const prompt = buildSequenceRepairPrompt(context, {
      kind: "carousel",
      frames: cafePlan().frames,
      fixes: [
        {
          index: 3,
          problems: ["the headline says what frame 1 says"],
          mustState: ["our Yaba bar"],
        },
      ],
    });
    expect(prompt).toContain('frame 1 (hook): title "The launch"');
    expect(prompt).toContain(
      "frame 4:\n  - the headline says what frame 1 says",
    );
    expect(prompt).toContain(
      'It must still state, in these words: "our Yaba bar"',
    );
    expect(prompt).not.toContain("Target aspect ratio");
  });
});

describe("buildFrameRegeneratePrompt", () => {
  it("shows the other frames and asks for this one, distinct", () => {
    const prompt = buildFrameRegeneratePrompt(context, {
      kind: "carousel",
      frames: cafePlan().frames,
      index: 0,
      mustState: [],
      offering: "cold brew",
    });
    expect(prompt).toContain(
      `Write frame 1 again, ${REGENERATE_VERSIONS} different versions of it`,
    );
    expect(prompt).not.toContain("frame 1 (hook): title");
    expect(prompt).toContain('frame 2 (body): title "The price"');
    expect(prompt).toContain('Each version names "cold brew"');
    expect(prompt).toContain('"cta" is ""');
  });
});

describe("buildHookRewritePrompt", () => {
  const prompt = buildHookRewritePrompt(context, {
    kind: "carousel",
    frames: cafePlan().frames,
    problems: [
      'the hook\'s headline "Cold brew is here" announces the offering',
    ],
    mustState: ["cold brew"],
    names: ["cold brew", "Kiln Coffee"],
  });

  it("shows the later frames, never the hook as one to keep", () => {
    expect(prompt).not.toContain("frame 1 (hook): title");
    expect(prompt).toContain('frame 2 (body): title "The price"');
    expect(prompt).toContain("No version says what a later frame says.");
  });

  it("names what is wrong and asks for one version per angle", () => {
    expect(prompt).toContain(
      '- the hook\'s headline "Cold brew is here" announces the offering',
    );
    expect(prompt).toContain(
      `Write ${HOOK_VERSIONS} different versions of frame 1`,
    );
    expect(prompt).toContain("a question the customer is already asking");
    expect(prompt).toContain("a before-and-after");
    expect(prompt).toContain("put the name in the subheadline");
  });

  it("holds every version to the names and facts the hook carries", () => {
    expect(prompt).toContain(
      'Each version names "cold brew" and "Kiln Coffee" in its headline or subheadline',
    );
    expect(prompt).toContain(
      'Each version states, in these words: "cold brew"',
    );
    expect(prompt).toContain(
      'each with "frame" set to 1, the title "The launch"',
    );
  });
});

describe("hookNames", () => {
  const brandSummary = { name: "Ledgerly" };

  it("is what the brief offers when the brand is not its subject", () => {
    expect(
      hookNames({ briefText: CAFE_BRIEF, brandSummary }, "cold brew"),
    ).toEqual(["cold brew"]);
  });

  it("adds the brand when the brief makes the brand its subject", () => {
    expect(
      hookNames(
        { briefText: "Ledgerly launches on 3 March.", brandSummary },
        "Send an invoice in under a minute",
      ),
    ).toEqual(["Send an invoice in under a minute", "Ledgerly"]);
  });

  it("is the brand alone when nothing on offer was read", () => {
    expect(hookNames({ briefText: "A deck.", brandSummary }, null)).toEqual([
      "Ledgerly",
    ]);
  });

  it("does not ask twice for a name the offering already holds", () => {
    expect(
      hookNames(
        { briefText: "Ledgerly Pro is out.", brandSummary },
        "Ledgerly Pro",
      ),
    ).toEqual(["Ledgerly Pro"]);
  });
});

describe("factList", () => {
  it("numbers facts from 1 with their kind", () => {
    expect(factList(CAFE_FACTS.slice(0, 2))).toBe(
      '1. (product) "cold brew"\n2. (price) "₦2,500 a bottle"',
    );
  });
});

describe("buildHookRewritePrompt with nothing code can name", () => {
  it("still asks for versions that could open stronger", () => {
    const prompt = buildHookRewritePrompt(context, {
      kind: "carousel",
      frames: cafePlan().frames,
      problems: [],
      mustState: [],
      names: ["cold brew"],
    });
    expect(prompt).not.toContain("It cannot go out");
    expect(prompt).toContain("could open stronger than it does");
  });
});

describe("buildSequenceChoicePrompt", () => {
  const plan = cafePlan();
  const other = plan.frames.map((f, i) =>
    i === 0 ? { ...f, headline: "Slow mornings, cold glasses" } : f,
  );
  const prompt = buildSequenceChoicePrompt(context, {
    kind: "carousel",
    drafts: [plan.frames, other],
  });

  it("numbers every draft in full", () => {
    expect(prompt).toContain("Draft 1:");
    expect(prompt).toContain("Draft 2:");
    expect(prompt).toContain('headline: "Slow mornings, cold glasses"');
  });

  it("holds them to the opening, one point per frame and the action", () => {
    expect(prompt).toContain("a question the customer is already asking");
    expect(prompt).toContain("no idea, detail or phrase given twice");
    expect(prompt).toContain("ends on one clear action");
    expect(prompt).toContain("Answer with the draft's number.");
  });
});

describe("buildHookChoicePrompt", () => {
  const plan = cafePlan();
  const prompt = buildHookChoicePrompt(context, {
    kind: "carousel",
    frames: plan.frames,
    hooks: [plan.frames[0], { ...plan.frames[0], headline: "Still rushing?" }],
  });

  it("shows the rest of the set and the numbered versions", () => {
    expect(prompt).toContain('frame 2 (body): title "The price"');
    expect(prompt).not.toContain("frame 1 (hook): title");
    expect(prompt).toContain('1. headline "Your Saturday, slowed down"');
    expect(prompt).toContain('2. headline "Still rushing?"');
  });

  it("asks for the opening that does not spend a later frame's point", () => {
    expect(prompt).toContain("does not spend a point a later frame makes");
    expect(prompt).toContain("Answer with the version's number.");
  });
});
