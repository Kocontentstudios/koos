import { describe, expect, it } from "vitest";
import {
  DESIGN_CATEGORIES,
  type DesignCategory,
  playbook,
  playbookBlock,
} from "./playbooks";

/* KOOS-AI-001 §1.2. Module 08 of the training manual gives complete starting
   logic per category — what to lead with, how to compose, what imagery proves
   the message, which footer, and what to avoid. None of it reached the art
   director, whose entire brief was "a single social media design". */
describe("the design-type playbooks", () => {
  it("covers the twelve categories the manual defines", () => {
    expect(DESIGN_CATEGORIES).toHaveLength(12);
  });

  it.each(DESIGN_CATEGORIES)("gives %s a complete playbook", (category) => {
    const entry = playbook(category);

    expect(entry.priority.length).toBeGreaterThanOrEqual(3);
    expect(entry.composition).toBeTruthy();
    expect(entry.imagery).toBeTruthy();
    expect(entry.background).toBeTruthy();
    expect(entry.footer).toBeTruthy();
    expect(entry.avoid.length).toBeGreaterThanOrEqual(2);
  });

  /* The priority order IS the playbook: it decides what becomes the headline
     and what becomes utility text. Getting it backwards produces a design that
     leads with a phone number. */
  it("leads a product promotion with the product, not the contact details", () => {
    expect(playbook("product").priority[0]).toMatch(/product/i);
  });

  it("leads a recruitment design with the role", () => {
    expect(playbook("recruitment").priority[0]).toMatch(/role|opportunity/i);
  });

  it("leads an offer with the offer itself", () => {
    expect(playbook("offer").priority[0]).toMatch(/offer/i);
  });

  /* Module 08 §9: a celebration post is relationship-building, and a hard sell
     in it is the documented failure. */
  it("keeps a celebration post from becoming a sales post", () => {
    expect(playbook("celebration").avoid.join(" ")).toMatch(/sale|cta/i);
  });

  it("treats imagery as secondary for an educational graphic", () => {
    expect(playbook("educational").imagery).toMatch(/secondary|information/i);
  });
});

describe("playbookBlock", () => {
  it("renders the priority order in order", () => {
    const block = playbookBlock("event");
    const priorities = playbook("event").priority;

    const positions = priorities.map((p) => block.indexOf(p));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("states what to avoid, because the manual's avoid lists are the sharp edges", () => {
    const block = playbookBlock("food");

    expect(block).toMatch(/avoid/i);
    expect(block).toMatch(/plastic|discount|equal/i);
  });

  it("names the category so the model cannot silently drift to another", () => {
    for (const category of DESIGN_CATEGORIES) {
      expect(playbookBlock(category as DesignCategory)).toContain(category);
    }
  });
});
