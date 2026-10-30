import { describe, expect, it } from "vitest";
import { CAFE_FACTS, cafePlan, withFrame } from "./fixtures";
import { hookFaults } from "./hook";
import { sequenceRepeats, withoutRepeats } from "./repeats";

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
      ['the hook does not name "Kiln Coffee"'],
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
    ).toEqual([expect.stringContaining("only the offering's name")]);
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
