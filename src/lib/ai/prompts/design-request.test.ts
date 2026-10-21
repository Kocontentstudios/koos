import { describe, expect, it } from "vitest";
import { DESIGN_TYPE_OPTIONS } from "@/lib/design/tickets-ui";
import {
  buildDeliverableIdentificationPrompt,
  buildDesignBriefSystemPrompt,
  deliverableIdentificationSystemPrompt,
} from "./design-request";
import type { BrandSummary } from "./strategy";

const brand: BrandSummary = {
  name: "Ekaete Foods",
  tone: "warm",
  primaryColor: "#1F5C3A",
};

/* KOOS-AI-001, first acceptance criterion. The identification step exists so
   the brief step can be handed one structure instead of four and an
   instruction to choose. */
describe("deliverable identification", () => {
  it("offers the standard labels so the answer lands on a known format", () => {
    const system = deliverableIdentificationSystemPrompt();
    for (const option of DESIGN_TYPE_OPTIONS) {
      expect(system).toContain(option);
    }
  });

  /* Empty string and zero are the schema's sentinels. A model that answers
     "unknown" or guesses 1080x1080 for a request that never mentioned a size
     defeats the point of having a per-format default. */
  /* Empty string and zero are the schema's sentinels. A model that answers
     "unknown" or guesses 1080x1080 for a request that never mentioned a size
     defeats the point of having a per-format default.

     Asserted on the sentence that sets each rule, not on the bare characters:
     `/\b0\b/` matched anywhere in the prompt, and the prompt interpolates
     every DESIGN_TYPE_OPTIONS label into it. */
  it("tells the model to leave the size and slide count empty when unstated", () => {
    const system = deliverableIdentificationSystemPrompt();
    expect(system).toMatch(/Otherwise an empty string/);
    expect(system).toMatch(/Use 0 for anything that is a single frame/);
  });

  /* An interface request has screens and a video has beats. Both resolve to a
     multiPage format, so a prompt that only mentions slides leaves them at
     zero and the stored brief claims a single frame. */
  it("counts screens and beats as pages, not only slides", () => {
    const system = deliverableIdentificationSystemPrompt();
    expect(system).toMatch(/screens/i);
    expect(system).toMatch(/beats/i);
  });

  it("carries the conversation it has to read", () => {
    expect(
      buildDeliverableIdentificationPrompt("user: need a flyer"),
    ).toContain("user: need a flyer");
  });
});

describe("buildDesignBriefSystemPrompt", () => {
  /* The routed structure, and only it. A prompt that still carried the other
     templates would leave the model free to ignore the routing. */
  it("carries exactly the routed format's structure", () => {
    const thumbnail = buildDesignBriefSystemPrompt(brand, "thumbnail");
    expect(thumbnail).toMatch(/Focal Subject/);
    expect(thumbnail).not.toMatch(/Utility Details/);

    const flyer = buildDesignBriefSystemPrompt(brand, "flyer");
    expect(flyer).toMatch(/Utility Details/);
    expect(flyer).not.toMatch(/Focal Subject/);

    /* The fallback for an unrecognised label must be the general case, not
       any one format's template: it used to be the flyer's, byte for byte. */
    const unknown = buildDesignBriefSystemPrompt(brand, "other");
    expect(unknown).toMatch(/Required Content/);
    expect(unknown).not.toMatch(/Utility Details/);
  });

  /* The old prompt asked the model to pick a template and to remember the
     default dimensions. Both are decided before it is called now, so leaving
     either instruction in would be telling it to redo settled work. */
  it("no longer asks the model to choose a template or a design type", () => {
    const prompt = buildDesignBriefSystemPrompt(brand, "social-post");
    expect(prompt).not.toMatch(/Pick (the template|designType)/i);
    expect(prompt).not.toMatch(/1080x1350/);
  });

  it("keeps the brand on the brief", () => {
    const prompt = buildDesignBriefSystemPrompt(brand, "flyer");
    expect(prompt).toContain("Ekaete Foods");
    expect(prompt).toContain("#1F5C3A");
  });

  /* A format the still renderer cannot produce has to say so in the brief
     rather than quietly briefing the nearest thing it can draw. */
  it("states the limitation for a format the renderer cannot produce", () => {
    expect(buildDesignBriefSystemPrompt(brand, "motion")).toMatch(
      /Production Note/,
    );
  });
});
