import { describe, expect, it } from "vitest";
import { TOUR_ANCHORS } from "./anchors";
import { TOUR_FINISH_LABEL, TOUR_PROMPT, TOUR_STEPS } from "./steps";

/* Copy is contractual: these are the ticket's strings, locked with toBe so an
   "improvement" to the wording has to be a deliberate change to this file. */
describe("tour copy", () => {
  it("matches the prompt card copy exactly", () => {
    expect(TOUR_PROMPT.headline).toBe("Take a quick tour of KOOS");
    expect(TOUR_PROMPT.body).toBe(
      "We'll show you where everything is, so you know how to create campaigns, request designs, and manage your brand.",
    );
    expect(TOUR_PROMPT.start).toBe("Start Tour");
    expect(TOUR_PROMPT.skip).toBe("Skip for Now");
    expect(TOUR_FINISH_LABEL).toBe("Finish Tour");
  });

  it("matches every step title and body exactly", () => {
    expect(TOUR_STEPS.map((s) => [s.title, s.body])).toEqual([
      [
        "Your Dashboard",
        "This is your main workspace. From here, you can see your brand activity and access the main tools in KOOS.",
      ],
      [
        "Your Brand Profile",
        "This is where KOOS stores what it knows about your business, audience, tone, offers, and brand details.",
      ],
      [
        "Create Campaigns",
        "Use this section to create marketing campaigns based on your brand, goals, and content needs.",
      ],
      [
        "Request a Design",
        "Submit a design request using AI, or upload your own brief and assets if you already know what you need.",
      ],
      [
        "Track Your Work",
        "View your submitted campaigns, design requests, and progress updates in one place.",
      ],
      [
        "Manage Your Account",
        "Update your profile, account details, preferences, and workspace settings here.",
      ],
      [
        "You're ready to use KOOS",
        "You can now create a campaign, request a design, or explore your dashboard.",
      ],
    ]);
  });
});

describe("tour step structure", () => {
  it("has seven steps with unique ids", () => {
    expect(TOUR_STEPS).toHaveLength(7);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(7);
  });

  it("leaves only the final step unanchored", () => {
    const unanchored = TOUR_STEPS.filter((s) => s.anchor === null);
    expect(unanchored).toHaveLength(1);
    expect(unanchored[0]).toBe(TOUR_STEPS.at(-1));
  });

  it("only points at anchors the contract declares", () => {
    const known = new Set<string>(Object.values(TOUR_ANCHORS));
    for (const step of TOUR_STEPS) {
      if (step.anchor) expect(known.has(step.anchor)).toBe(true);
    }
  });

  it("marks exactly the sidebar-anchored steps as nav steps", () => {
    // These are the steps that must open the mobile drawer before they show.
    expect(
      TOUR_STEPS.map((s, i) => (s.isNav ? i : null)).filter((i) => i !== null),
    ).toEqual([1, 2, 4, 5]);
  });
});
