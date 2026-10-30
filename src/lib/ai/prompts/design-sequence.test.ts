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
  buildOutlinePrompt,
  buildSequenceEditPrompt,
  buildSequenceSystemPrompt,
  factList,
  HOOK_VERSIONS,
  hookNames,
  REGENERATE_VERSIONS,
  REPAIR_VERSIONS,
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

  it("puts a carousel's price beside the action, and gives it no beat of its own", () => {
    const prompt = buildOutlinePrompt(context, outlineInput);
    expect(prompt).toContain("so it sits on frame 5 beside the action");
    expect(prompt).not.toContain('"price", "when-where"');
    const deck = buildOutlinePrompt(context, {
      ...outlineInput,
      kind: "presentation",
    });
    expect(deck).toContain("sits on slide 5 beside how to act");
    expect(deck).toContain('"price", "when-where"');
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

  it("tells each frame which points other frames own", () => {
    const outlined = (role: "hook" | "body" | "cta", title: string) => ({
      role,
      title,
      point: `About ${title}`,
      facts: [],
      layout: "hero-center",
      showsImage: false,
    });
    const prompt = buildFrameCopyPrompt(context, {
      kind: "carousel",
      offering: "cold brew",
      imageSource: "none",
      aspectRatio: "4:5",
      frames: [
        outlined("hook", "The opener"),
        outlined("body", "The steep"),
        outlined("body", "The beans"),
        outlined("cta", "Reserve"),
      ],
    });
    const blocks = prompt.split("\n\n");
    const block = (n: number) =>
      blocks.find((b) => b.startsWith(`frame ${n} (`)) ?? "";
    expect(block(1)).toContain(
      'leaves to the other frames, so says nothing of: "The steep", "The beans"',
    );
    expect(block(2)).toContain('so says nothing of: "The beans"');
    expect(block(2)).not.toContain('"The opener"');
    expect(block(4)).toContain(
      'so says nothing of: "The opener", "The steep", "The beans"',
    );
  });
});

describe("buildSequenceEditPrompt", () => {
  const plan = cafePlan();
  const prompt = buildSequenceEditPrompt(context, {
    kind: "carousel",
    frames: plan.frames,
    fixes: [
      {
        index: 3,
        problems: ["the headline says what frame 1 says"],
        mustState: ["our Yaba bar"],
      },
    ],
    hookProblems: [
      'the hook\'s headline "Cold brew is here" announces the offering',
    ],
    mustState: [["cold brew"], ["₦2,500 a bottle"], [], ["our Yaba bar"], []],
    names: ["cold brew", "Kiln Coffee"],
  });

  it("lists every frame with what it must state and the problems code found", () => {
    expect(prompt).toContain('frame 1 (hook): title "The launch"');
    expect(prompt).toContain('frame 5 (cta): title "Reserve yours"');
    expect(prompt).toContain(
      '  must state, in these words: "our Yaba bar"\n  problem: the headline says what frame 1 says',
    );
    expect(prompt).not.toContain("Target aspect ratio");
  });

  it("reads the set as an editor would, on the judge's three tests", () => {
    expect(prompt).toContain("You are the editor.");
    expect(prompt).toContain("1. Frame 1 gives a concrete reason");
    expect(prompt).toContain("said in other words still counts");
    expect(prompt).toContain(
      "no frame that only gives a fact without what it means for the reader",
    );
    expect(prompt).toContain("3. Frame 5 carries one clear action");
    expect(prompt).toContain('In "review", list every frame after frame 1');
  });

  it("asks for the hook in every angle, held to what code found and its names", () => {
    expect(prompt).toContain(`Frame 1, ${HOOK_VERSIONS} versions`);
    expect(prompt).toContain("a question that holds it");
    expect(prompt).toContain("that no later frame is about");
    expect(prompt).toContain("a before-and-after");
    expect(prompt).toContain(
      'Each version names "cold brew" and "Kiln Coffee", in these words.',
    );
    expect(prompt).toContain(
      '- the hook\'s headline "Cold brew is here" announces the offering',
    );
  });

  it("asks for versions of the frames listed and the frames the review names, and no other", () => {
    expect(prompt).toContain(
      `every frame your review names, ${REPAIR_VERSIONS} versions each`,
    );
    expect(prompt).toContain("- No other frame.");
  });

  it("still asks for a stronger hook when code finds nothing wrong", () => {
    const clean = buildSequenceEditPrompt(context, {
      kind: "carousel",
      frames: plan.frames,
      fixes: [],
      hookProblems: [],
      mustState: [],
      names: ["cold brew"],
    });
    expect(clean).not.toContain("cannot go out");
    expect(clean).toContain("could open stronger than frame 1 does now");
  });

  it("speaks of slides in a deck", () => {
    const deck = buildSequenceEditPrompt(context, {
      kind: "presentation",
      frames: plan.frames,
      fixes: [],
      hookProblems: [],
      mustState: [],
      names: [],
    });
    expect(deck).toContain("Slide 1, 3 versions");
    expect(deck).toContain("button on slide 5 only");
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
