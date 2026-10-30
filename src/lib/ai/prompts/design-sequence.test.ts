import { describe, expect, it } from "vitest";
import type { ArcPoint } from "@/lib/design/sequence/arc";
import { cafePlan } from "@/lib/design/sequence/fixtures";
import { directionsContext } from "@/lib/jobs/directions/fixtures";
import {
  buildArcCopyPrompt,
  buildArcPrompt,
  buildFixPrompt,
  buildFrameRegeneratePrompt,
  buildSequenceSystemPrompt,
  type ClaimedFrame,
  FIX_VERSIONS,
  hookNames,
  OTHER_HOOKS,
  pointList,
  REGENERATE_VERSIONS,
} from "./design-sequence";

/* A brief that is no eval fixture: a bicycle workshop. */
const BRIEF =
  "Bike servicing at our Ojota workshop. Gears tuned and brakes bled in one visit. ₦12,000 a service. Message 0809 111 2222 to book.";

const context = directionsContext({
  title: "Bike service week",
  briefText: BRIEF,
  designType: "Instagram carousel",
  brandSummary: { name: "Spoke & Chain" },
});

const POOL: ArcPoint[] = [
  {
    source: "brief",
    text: "Gears tuned and brakes bled in one visit",
    facts: [],
  },
  { source: "profile", text: "Mechanics who race on weekends", facts: [] },
];

const arcInput = {
  kind: "carousel" as const,
  frameCount: 4,
  aspectRatio: "4:5",
  pool: POOL,
  actionFacts: ["₦12,000 a service", "Message 0809 111 2222"],
  offering: "bike servicing",
  imageSource: "ko" as const,
  imageAttached: false,
};

const CLAIMED: ClaimedFrame[] = [
  {
    role: "hook",
    title: "One visit",
    claim: "Your bike leaves tuned and safe after one visit",
    facts: [],
    layout: "banner-bottom",
    showsImage: true,
  },
  {
    role: "body",
    title: "The work",
    claim: "Gears tuned and brakes bled in one visit",
    facts: [],
    layout: "hero-center",
    showsImage: false,
  },
  {
    role: "body",
    title: "Who fixes it",
    claim: "Mechanics who race on weekends",
    facts: [],
    layout: "quote-card",
    showsImage: false,
  },
  {
    role: "cta",
    title: "Book a service",
    claim: "",
    facts: ["₦12,000 a service", "Message 0809 111 2222"],
    layout: "split-left",
    showsImage: true,
  },
];

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

describe("buildArcPrompt", () => {
  it("numbers every point by its source and asks for no copy", () => {
    const prompt = buildArcPrompt(context, arcInput);
    expect(prompt).toContain("Plan the arc of the carousel before any copy");
    expect(prompt).toContain(
      '1. (the brief says) "Gears tuned and brakes bled in one visit"',
    );
    expect(prompt).toContain(
      '2. (the brand profile says) "Mechanics who race on weekends"',
    );
    expect(prompt).toContain("Write no copy.");
  });

  it("asks for the hook's angle, never a price, and the action's facts on the last frame", () => {
    const prompt = buildArcPrompt(context, arcInput);
    expect(prompt).toContain('write "hookAngle"');
    expect(prompt).toContain("The angle never gives a price");
    expect(prompt).toContain(
      'carries "₦12,000 a service", "Message 0809 111 2222", so no earlier frame states those',
    );
  });

  it("asks for distinct points and titles, brief before profile, and a ranked spare list", () => {
    const prompt = buildArcPrompt(context, arcInput);
    expect(prompt).toContain("Every frame a different point");
    expect(prompt).toContain("Take the brief's own points first");
    expect(prompt).toContain("No two frames share a title, in any casing");
    expect(prompt).toContain('"spare": every point no frame uses');
  });

  it("says when there is no point beyond the offering", () => {
    expect(buildArcPrompt(context, { ...arcInput, pool: [] })).toContain(
      "(none: the brief and the profile give no point beyond the offering)",
    );
  });

  it("speaks of slides in a deck, whose price may be a slide's point", () => {
    const prompt = buildArcPrompt(context, {
      ...arcInput,
      kind: "presentation",
      aspectRatio: "16:9",
    });
    expect(prompt).toContain("Slides 2 to 3");
    expect(prompt).not.toContain("a date, a time or a place");
    expect(prompt).toContain("what is asked for and what it buys");
  });

  it("tells the planner what each image source allows", () => {
    expect(
      buildArcPrompt(context, { ...arcInput, imageSource: "none" }),
    ).toContain("Every frame is text-led");
    expect(
      buildArcPrompt(context, {
        ...arcInput,
        imageSource: "upload",
        imageAttached: true,
      }),
    ).toContain("The photograph is attached");
  });
});

describe("pointList", () => {
  it("numbers points from 1 with their source", () => {
    expect(pointList(POOL.slice(0, 1))).toBe(
      '1. (the brief says) "Gears tuned and brakes bled in one visit"',
    );
  });
});

describe("buildArcCopyPrompt", () => {
  const prompt = buildArcCopyPrompt(context, {
    kind: "carousel",
    frames: CLAIMED,
    offering: "bike servicing",
    imageSource: "ko",
    aspectRatio: "4:5",
  });

  it("gives each frame its own claim as the only point it makes", () => {
    expect(prompt).toContain(
      'its claim, the only point it makes: "Mechanics who race on weekends"',
    );
    expect(prompt).toContain(
      "its claim: how to act, and what the reader gets by acting",
    );
  });

  it("tells each frame the claims and facts it leaves to the others", () => {
    const frame2 = prompt.slice(
      prompt.indexOf("frame 2 ("),
      prompt.indexOf("frame 3 ("),
    );
    expect(frame2).toContain('"Mechanics who race on weekends" (frame 3)');
    expect(frame2).toContain('"₦12,000 a service" (frame 4)');
    expect(frame2).not.toContain(
      'must not say, in any words, the points of the other frames: "Gears tuned',
    );
  });

  it("asks for more openings on the same claim, and whole-sentence subheadlines", () => {
    expect(prompt).toContain(`write frame 1 ${OTHER_HOOKS} more ways`);
    expect(prompt).toContain("Every subheadline is a whole sentence");
    expect(prompt).toContain("every headline is in sentence case");
  });

  it("makes the hook name the offering", () => {
    expect(prompt).toContain('must name, in these words: "bike servicing"');
  });
});

describe("buildFixPrompt", () => {
  const plan = cafePlan().frames.slice(0, 4);

  it("lists every frame's claim and faults and asks for the faulted frames only", () => {
    const prompt = buildFixPrompt(context, {
      kind: "carousel",
      plan,
      frames: CLAIMED,
      fixes: [{ index: 2, faults: ["its title is frame 2's title"] }],
      names: ["bike servicing"],
    });
    expect(prompt).toContain(
      `Rewrite frames 3 only, ${FIX_VERSIONS} versions each`,
    );
    expect(prompt).toContain("  fault: its title is frame 2's title");
    expect(prompt).toContain('  its claim: "Mechanics who race on weekends"');
    expect(prompt).toContain("Leave a field that has no fault as it is");
    expect(prompt).not.toContain("HOOK: earns the swipe");
  });

  it("gives a frame whose point was taken its new claim", () => {
    const prompt = buildFixPrompt(context, {
      kind: "carousel",
      plan,
      frames: CLAIMED,
      fixes: [
        {
          index: 0,
          faults: ["the hook's headline announces the offering"],
        },
        {
          index: 1,
          faults: ["its headline makes frame 1's point again"],
          newClaim: "Collection from your gate",
        },
      ],
      names: ["bike servicing"],
    });
    expect(prompt).toContain(
      'NEW CLAIM: its point was another frame\'s, so it now makes this one instead: "Collection from your gate"',
    );
    expect(prompt).toContain("HOOK: earns the swipe");
    expect(prompt).toContain('Frame 1 names "bike servicing"');
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
    expect(hookNames({ briefText: BRIEF, brandSummary }, "cold brew")).toEqual([
      "cold brew",
    ]);
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
