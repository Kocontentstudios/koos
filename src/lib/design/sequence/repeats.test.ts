import { describe, expect, it } from "vitest";
import { CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { hookFaults, hookPreviews, namesFree } from "./hook";
import { sequenceRepeats, withoutRecap, withoutRepeats } from "./repeats";

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
        "is only the name of what is offered; make the headline the reason to swipe",
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
    expect(faults[0]).toContain("put the name in the subheadline");
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
