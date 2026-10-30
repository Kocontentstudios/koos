import { describe, expect, it } from "vitest";
import type { FrameBeat } from "./contract";
import { beatOf, CAFE_FACTS, cafePlan, fact, withFrame } from "./fixtures";
import { hookFaults, hookPreviews, namesFree } from "./hook";
import {
  factsTwiceInFrame,
  sequenceRepeats,
  withoutFactWords,
  withoutRecap,
  withoutRepeats,
} from "./repeats";

const details = (plan = cafePlan()) =>
  sequenceRepeats(plan.frames, CAFE_FACTS, "cold brew");

describe("sequenceRepeats", () => {
  it("finds nothing in a set that says everything once", () => {
    expect(details()).toEqual([]);
  });

  it("names a fact given again on a later frame", () => {
    const plan = withFrame(cafePlan(), 4, {
      subheadline: "₦2,500 a bottle",
    });
    expect(details(plan)).toContainEqual({
      frame: 4,
      detail: 'it gives "₦2,500 a bottle" again, which frame 2 already states',
    });
  });

  it("lets the offering be named on more than one frame", () => {
    const plan = withFrame(cafePlan(), 3, {
      subheadline: "Take a cold brew to go",
    });
    expect(details(plan).filter((r) => r.frame === 3)).toEqual([]);
  });

  it("names a number given on two frames that no fact names", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 0, {
        subheadline: "Our cold brew, 18 hours in the making",
      }),
      1,
      { subheadline: "18 hours of steeping in every one" },
    );
    expect(details(plan)).toContainEqual({
      frame: 1,
      detail: "it gives 18 again, which frame 1 already gives",
    });
  });

  it("names a subheadline that restates its own headline", () => {
    const plan = withFrame(cafePlan(), 3, {
      headline: "Pour one at our Yaba bar",
      subheadline: "Pour yourself one at the Yaba bar",
    });
    expect(details(plan)).toContainEqual(
      expect.objectContaining({
        frame: 3,
        detail: "the subheadline says the headline again",
      }),
    );
  });

  it("names a line another frame already used", () => {
    const plan = withFrame(cafePlan(), 3, {
      subheadline: "Your Saturday, slowed right down",
    });
    expect(details(plan)).toContainEqual({
      frame: 3,
      detail:
        '"Your Saturday, slowed right down" says what frame 1 already says',
    });
  });

  it("leaves two alike headlines to validateSequence's headline-repeat", () => {
    const plan = withFrame(cafePlan(), 3, {
      headline: "Your Saturday, slowed right down",
    });
    expect(details(plan).filter((r) => r.frame === 3)).toEqual([]);
  });

  it("names a phrase two frames both say, in lines that otherwise differ", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, {
        subheadline: "Bottled by hand in our working kitchen",
      }),
      3,
      { subheadline: "Brewed in our working kitchen, poured at the bar" },
    );
    expect(details(plan)).toContainEqual({
      frame: 3,
      detail:
        'it says "our working kitchen", which frame 2 already says; say this frame\'s point in its own words',
    });
  });

  it("lets the brand's and the offering's names be the phrase two frames share", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, {
        subheadline: "Kiln Coffee cold brew, bottled",
      }),
      3,
      { subheadline: "Pour Kiln Coffee cold brew at the bar" },
    );
    const said = sequenceRepeats(
      plan.frames,
      CAFE_FACTS,
      "cold brew",
      "Kiln Coffee",
    ).filter((r) => r.detail.startsWith("it says"));
    expect(said).toEqual([]);
  });

  it("leaves a brief fact said twice to the fact check, not the phrase check", () => {
    const plan = withFrame(cafePlan(), 4, {
      subheadline: "Saturday 15 November",
    });
    const found = details(plan).filter((r) => r.frame === 4);
    expect(found).toContainEqual({
      frame: 4,
      detail:
        'it gives "Saturday 15 November" again, which frame 3 already states',
    });
    expect(found.filter((r) => r.detail.startsWith("it says"))).toEqual([]);
  });
});

describe("sequenceRepeats: the action", () => {
  it("names a middle frame that asks for the last frame's action", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 4, { cta: "Reserve on WhatsApp" }),
      1,
      { subheadline: "Reserve a bottle before you arrive" },
    );
    expect(details(plan)).toContainEqual({
      frame: 1,
      detail:
        'it asks for the action ("Reserve on WhatsApp") the last frame carries; keep this frame to its own point',
    });
  });

  it("never holds the hook or the last frame to it", () => {
    const plan = withFrame(cafePlan(), 4, {
      cta: "Reserve a bottle",
      headline: "Reserve a bottle before Saturday",
    });
    expect(
      details(plan).filter((r) => r.detail.includes("asks for the action")),
    ).toEqual([]);
  });
});

describe("withoutRecap", () => {
  it("drops a footer line that only gives again facts an earlier frame states", () => {
    const plan = withFrame(cafePlan(), 4, {
      footerLines: [
        "WhatsApp 0803 555 0142",
        "Saturday 15 November",
        "8am to 2pm",
      ],
    });
    expect(withoutRecap(plan.frames, CAFE_FACTS)[4].footerLines).toEqual([
      "WhatsApp 0803 555 0142",
    ]);
  });

  it("keeps a contact, a fact no earlier frame states, and a line with no fact", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "One Saturday morning",
      subheadline: "",
    });
    const last = withFrame(plan, 4, {
      footerLines: [
        "WhatsApp 0803 555 0142",
        "Saturday 15 November",
        "Ask for Tola",
      ],
    });
    expect(withoutRecap(last.frames, CAFE_FACTS)[4].footerLines).toEqual([
      "WhatsApp 0803 555 0142",
      "Saturday 15 November",
      "Ask for Tola",
    ]);
  });

  it("is part of withoutRepeats", () => {
    const plan = withFrame(cafePlan(), 4, {
      footerLines: ["WhatsApp 0803 555 0142", "₦2,500 a bottle"],
    });
    expect(
      withoutRepeats(plan.frames, CAFE_FACTS, "cold brew")[4].footerLines,
    ).toEqual(["WhatsApp 0803 555 0142"]);
  });
});

describe("withoutRepeats", () => {
  it("drops a footer item the copy above already carries, losing nothing", () => {
    const plan = withFrame(cafePlan(), 4, {
      subheadline: "WhatsApp 0803 555 0142 to reserve",
      footerLines: ["WhatsApp 0803 555 0142"],
    });
    const frames = withoutRepeats(plan.frames, CAFE_FACTS, "cold brew");
    expect(frames[4].footerLines).toEqual([]);
    expect(frames[4].subheadline).toBe("WhatsApp 0803 555 0142 to reserve");
  });

  it("drops a subheadline that only restates its headline", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "₦2,500 a bottle",
      subheadline: "Just ₦2,500 a bottle",
    });
    const frames = withoutRepeats(plan.frames, CAFE_FACTS, "cold brew");
    expect(frames[1].subheadline).toBe("");
    expect(frames[1].headline).toBe("₦2,500 a bottle");
  });

  it("never drops the only place a fact is stated", () => {
    const plan = withFrame(cafePlan(), 2, {
      headline: "Saturday 15 November",
      subheadline: "8am to 2pm",
    });
    const frames = withoutRepeats(plan.frames, CAFE_FACTS, "cold brew");
    expect(frames[2].subheadline).toBe("8am to 2pm");
  });

  it("changes nothing else and writes no word", () => {
    const frames = withoutRepeats(cafePlan().frames, CAFE_FACTS, "cold brew");
    expect(frames).toEqual(cafePlan().frames);
  });
});

describe("hookFaults", () => {
  const hook = cafePlan().frames[0];

  it("passes a hook that gives a reason to swipe", () => {
    expect(hookFaults(hook, "cold brew")).toEqual([]);
  });

  it.each([
    "Cold brew is here",
    "Our cold brew has arrived",
    "Introducing Kiln cold brew",
    "Cold brew, just landed",
    "New in: hand-dyed adire",
    "Now available at our Yaba bar",
  ])("names an announcement: %s", (headline) => {
    expect(hookFaults({ ...hook, headline }, "cold brew")).toContainEqual(
      expect.stringContaining("announces the offering"),
    );
  });

  it("names each other name the hook must carry, never the offering twice", () => {
    expect(hookFaults(hook, "cold brew", ["cold brew", "Kiln Coffee"])).toEqual(
      [
        'the hook does not name "Kiln Coffee"; put it in the subheadline in these words',
      ],
    );
    expect(
      hookFaults(
        { ...hook, subheadline: "Kiln Coffee's cold brew, poured over ice" },
        "cold brew",
        ["cold brew", "Kiln Coffee"],
      ),
    ).toEqual([]);
  });

  it("names a headline that is only the offering's name", () => {
    expect(
      hookFaults(
        { ...hook, headline: "Teen sourdough baking class" },
        "Teen sourdough baking class",
      ),
    ).toEqual([
      expect.stringContaining(
        "is only the name of what is offered; build the headline on the most concrete thing",
      ),
    ]);
  });

  it("names an announcement once, with what to do instead", () => {
    const faults = hookFaults(
      {
        ...hook,
        headline: "Hand-dyed indigo adire is here",
        subheadline: "Made in Abeokuta",
      },
      "hand-dyed indigo adire",
    );
    expect(faults).toEqual([expect.stringContaining("announces the offering")]);
    expect(faults[0]).toContain(
      "name the offering in the headline or the subheadline",
    );
  });

  it("names a subheadline that says its headline again", () => {
    expect(
      hookFaults(
        {
          ...hook,
          headline: "Invoice in naira or dollars in seconds",
          subheadline:
            "Ledgerly: send an invoice in naira or dollars in under a minute.",
        },
        "Ledgerly",
        [],
        "Ledgerly",
      ),
    ).toEqual([expect.stringContaining("says what its headline says")]);
  });

  it("lets a subheadline share a word or two with its headline", () => {
    expect(
      hookFaults(
        {
          ...hook,
          headline: "Still chasing late invoices?",
          subheadline: "Ledgerly sends the reminder for you.",
        },
        "Ledgerly",
        [],
        "Ledgerly",
      ),
    ).toEqual([]);
  });

  it("does not mistake a sentence that uses those words for one", () => {
    expect(
      hookFaults(
        { ...hook, headline: "Here is why 18 hours matters" },
        "cold brew",
      ),
    ).toEqual([]);
    expect(
      hookFaults(
        { ...hook, headline: "Can your teen bake real sourdough?" },
        "Teen sourdough baking class",
      ),
    ).toEqual([]);
  });
});

describe("hookFaults: announcements", () => {
  const hook = cafePlan().frames[0];

  it.each([
    "New hand-dyed indigo adire arrived",
    "Cold brew, out now",
    "Adire back in stock",
    "Cold Brew, Finally at Kiln",
  ])(
    "names a headline that announces without the word 'here': %s",
    (headline) => {
      expect(hookFaults({ ...hook, headline }, "cold brew")).toContainEqual(
        expect.stringContaining("announces the offering"),
      );
    },
  );

  it("names a subheadline that spends the headline's pull on an announcement", () => {
    expect(
      hookFaults(
        {
          ...hook,
          headline: "Where does your cloth come from?",
          subheadline: "Hand-dyed indigo adire, just arrived at Adire House.",
        },
        "hand-dyed indigo adire",
      ),
    ).toEqual([expect.stringContaining("subheadline")]);
  });
});

describe("hookPreviews", () => {
  it("names a later frame whose point the hook already spends", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 0, {
        headline: "Where does your coffee come from?",
        subheadline: "Kiln cold brew, from Mambilla beans roasted in-house",
      }),
      1,
      { headline: "Mambilla beans, roasted here", subheadline: "" },
    );
    expect(hookPreviews(plan.frames, "cold brew", "Kiln Coffee")).toEqual([
      expect.stringContaining('frame 2 ("Mambilla beans, roasted here")'),
    ]);
  });

  it("leaves the brand's and the offering's names free, and a headline repeat to the validator", () => {
    expect(hookPreviews(cafePlan().frames, "cold brew", "Kiln Coffee")).toEqual(
      [],
    );
    const plan = withFrame(cafePlan(), 3, {
      headline: "Your Saturday, slowed right down",
    });
    expect(hookPreviews(plan.frames, "cold brew", "Kiln Coffee")).toEqual([]);
  });
});

describe("namesFree", () => {
  it("frees an offering read as a name, never one read as a description", () => {
    expect([...namesFree("Ledgerly", "Ledgerly")]).toEqual(["ledgerly"]);
    const described = namesFree(
      "Ledgerly",
      "Send an invoice in naira or dollars in under a minute",
    );
    expect(described.has("naira")).toBe(false);
    expect(described.has("ledgerly")).toBe(true);
  });
});

/* The round-2 critic's event run (u1r2c/eval-n5.json), as the planner
   left it: frame 5 gave frame 4's date, time and address again. */
const EVENT_FACTS = [
  fact("date", "Saturday 22 November"),
  fact("time", "10am to 1pm"),
  fact("place", "9 Bourdillon Road, Ikoyi"),
  fact("price", "₦25,000 per person"),
  fact("offer", "apron and starter to take home"),
  fact("quantity", "12 places"),
  fact("contact", "WhatsApp 0812 345 6789"),
];
const eventFrames = (): FrameBeat[] => [
  beatOf({
    role: "hook",
    headline: "One Saturday. A proper sourdough loaf.",
    subheadline: "Teen sourdough baking class · With head baker Tunde Okafor.",
  }),
  beatOf({
    headline: "Taught by our own head baker",
    subheadline: "Every class runs in our working kitchen — not a hired venue.",
  }),
  beatOf({
    headline: "Yours to keep, yours to grow",
    subheadline:
      "Apron and starter to take home — the learning carries on after the class.",
  }),
  beatOf({
    headline: "₦25,000 per person",
    subheadline:
      "Only 12 places. Saturday 22 November, 10am to 1pm — 9 Bourdillon Road, Ikoyi.",
  }),
  beatOf({
    role: "cta",
    headline: "Secure your teen's place",
    cta: "Book on WhatsApp",
    footerLines: [
      "WhatsApp 0812 345 6789",
      "9 Bourdillon Road, Ikoyi",
      "Saturday 22 November · 10am–1pm",
    ],
  }),
];

describe("withoutRecap: the round-2 event run", () => {
  /* Fact indexes in EVENT_FACTS: frame 4 owns the date and time. */
  const DATE_AND_TIME_ON_4 = [[], [], [4], [0, 1, 5], [2, 3, 6]];
  const logisticsOn4 = () => {
    const frames = eventFrames();
    frames[3] = {
      ...frames[3],
      subheadline: "Only 12 places.",
      footerLines: ["Saturday 22 November", "10am to 1pm"],
    };
    return frames;
  };

  it("says the date, time and address once, on the action frame", () => {
    const frames = withoutRecap(eventFrames(), EVENT_FACTS);
    expect(frames[3].subheadline).toBe("Only 12 places.");
    expect(frames[4]).toEqual(eventFrames()[4]);
    expect(
      sequenceRepeats(frames, EVENT_FACTS, "Teen sourdough baking class").map(
        (r) => r.detail,
      ),
    ).not.toContainEqual(expect.stringContaining("again"));
  });

  it("keeps a fact on the frame the outline gave it, dropping only its words elsewhere", () => {
    const frames = logisticsOn4();
    frames[4] = {
      ...frames[4],
      footerLines: [
        "Saturday 22 November · 10am to 1pm · 9 Bourdillon Road, Ikoyi",
        "WhatsApp 0812 345 6789",
      ],
    };
    expect(
      withoutRecap(frames, EVENT_FACTS, DATE_AND_TIME_ON_4)[4].footerLines,
    ).toEqual(["9 Bourdillon Road, Ikoyi", "WhatsApp 0812 345 6789"]);
  });

  it("drops a repeated fact from a later subheadline, keeping the rest of it", () => {
    const frames = logisticsOn4();
    frames[4] = {
      ...frames[4],
      subheadline: "Saturday 22 November, 10am to 1pm. Bring your teen hungry.",
    };
    expect(
      withoutRecap(frames, EVENT_FACTS, DATE_AND_TIME_ON_4)[4].subheadline,
    ).toBe("Bring your teen hungry.");
  });

  it("never leaves words leaning on the fact it dropped", () => {
    const frames = logisticsOn4();
    frames[4] = {
      ...frames[4],
      subheadline: "Book before Saturday 22 November",
    };
    expect(
      withoutRecap(frames, EVENT_FACTS, DATE_AND_TIME_ON_4)[4].subheadline,
    ).toBe("Book before Saturday 22 November");
  });

  it("never cuts a headline, nor leaves a line that cannot stand alone", () => {
    const frames = eventFrames();
    frames[3] = {
      ...frames[3],
      headline: "Saturday 22 November",
      subheadline: "",
    };
    const kept = withoutRecap(frames, EVENT_FACTS);
    expect(kept[3].headline).toBe("Saturday 22 November");
    /* "10am–1pm" alone is a bare time (isFragment), so the line stays. */
    expect(kept[4].footerLines).toContain("Saturday 22 November · 10am–1pm");
  });
});

describe("withoutFactWords", () => {
  const date = fact("date", "Saturday 22 November");

  it("drops the fact and the mark that joined it", () => {
    expect(withoutFactWords("Saturday 22 November · 10am to 1pm", date)).toBe(
      "10am to 1pm",
    );
    expect(withoutFactWords("10am to 1pm, Saturday 22 November", date)).toBe(
      "10am to 1pm",
    );
    expect(withoutFactWords("Saturday 22 November", date)).toBe("");
  });

  it("refuses a fact not written whole, or a rest that leans on it", () => {
    expect(withoutFactWords("Sat 22 November · 10am", date)).toBeNull();
    expect(withoutFactWords("Come on Saturday 22 November", date)).toBeNull();
    expect(withoutFactWords("Saturday 22 Novembers", date)).toBeNull();
  });
});

describe("sequenceRepeats: numbers inside brief facts", () => {
  it("never charges two facts that share a digit as one number said twice", () => {
    const facts = [
      fact("date", "3 March"),
      fact("offer", "Free for your first 3 months"),
    ];
    const frames = [
      beatOf({ role: "hook", headline: "Still chasing payment?" }),
      beatOf({ headline: "Launches on 3 March" }),
      beatOf({
        role: "cta",
        headline: "Free for your first 3 months",
        cta: "Sign up free",
      }),
    ];
    expect(
      sequenceRepeats(frames, facts, "Ledgerly").map((r) => r.detail),
    ).not.toContainEqual(expect.stringContaining("gives 3 again"));
  });

  it("still charges a number no fact holds, said on two frames", () => {
    const frames = [
      beatOf({ role: "hook", headline: "18 hours for one bottle" }),
      beatOf({ headline: "18 hours. Not a minute less." }),
    ];
    expect(sequenceRepeats(frames, CAFE_FACTS, "cold brew")).toContainEqual({
      frame: 1,
      detail: expect.stringContaining("gives 18 again"),
    });
  });
});

describe("hookFaults: a name and a place is still a label", () => {
  const hook = cafePlan().frames[0];

  it("names a headline that is only the offering and where it is (round 3, judged 2)", () => {
    expect(
      hookFaults(
        { ...hook, headline: "Cold brew at our Yaba bar" },
        "cold brew",
        [],
        "Kiln Coffee",
        CAFE_FACTS,
      ),
    ).toContainEqual(
      expect.stringContaining("is only the name of what is offered"),
    );
  });

  it("passes a headline that adds its own pull to the place", () => {
    expect(
      hookFaults(
        { ...hook, headline: "Your Saturday ritual, at our Yaba bar" },
        "cold brew",
        [],
        "Kiln Coffee",
        CAFE_FACTS,
      ),
    ).not.toContainEqual(expect.stringContaining("only the name"));
  });
});

describe("factsTwiceInFrame (round-5 critic, MEDIUM 7)", () => {
  it("finds a fact one frame gives in two fields", () => {
    const beat = beatOf({
      role: "cta",
      headline: "Reserve yours",
      subheadline: "₦2,500 a bottle, on WhatsApp 0803 555 0142.",
      footerLines: ["₦2,500 a bottle", "WhatsApp 0803 555 0142"],
    });
    expect(factsTwiceInFrame(beat, CAFE_FACTS).map((f) => f.text)).toEqual([
      "₦2,500 a bottle",
      "WhatsApp 0803 555 0142",
    ]);
    expect(factsTwiceInFrame({ ...beat, subheadline: "" }, CAFE_FACTS)).toEqual(
      [],
    );
  });
});

describe("sequenceRepeats: one idea headlined twice (round-5 critic, MEDIUM 5)", () => {
  it("names a later headline built on an earlier one's words", () => {
    const plan = withFrame(
      withFrame(cafePlan(), 1, {
        headline: "Late payments? We chase them.",
      }),
      3,
      { headline: "Late payment reminders, sent for you" },
    );
    const found = sequenceRepeats(plan.frames, CAFE_FACTS, "cold brew");
    expect(found).toContainEqual({
      frame: 3,
      detail: expect.stringContaining("one idea headlined twice"),
    });
  });

  it("leaves headlines that share one word", () => {
    const plan = withFrame(cafePlan(), 1, {
      headline: "Never chase a client again",
    });
    const found = sequenceRepeats(
      withFrame(plan, 3, { headline: "We chase so you rest" }).frames,
      CAFE_FACTS,
      "cold brew",
    );
    expect(
      found.some((r) => r.detail.includes("one idea headlined twice")),
    ).toBe(false);
  });
});
