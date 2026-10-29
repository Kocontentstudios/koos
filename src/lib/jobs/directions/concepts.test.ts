import { describe, expect, it } from "vitest";
import {
  DESIGN_CATEGORIES,
  playbook,
} from "@/lib/ai/design-training/playbooks";
import { planConcepts, regenerationConcept } from "./concepts";

describe("planConcepts", () => {
  it("leads the first direction with the playbook's first priority", () => {
    const [show, say] = planConcepts("food");
    expect(show.id).toBe("show");
    expect(show.lead).toBe(playbook("food").priority[0]);
    expect(say.id).toBe("say");
    expect(say.lead).toBe("appetite appeal");
  });

  it("never leads with a call to action or a utility detail", () => {
    for (const category of DESIGN_CATEGORIES) {
      const lenses = [...planConcepts(category), regenerationConcept(category)];
      for (const lens of lenses) {
        expect(lens.lead).not.toMatch(/\b(cta|contact|deadline|date)\b/i);
      }
    }
  });

  it("gives the two directions different leads in every category", () => {
    for (const category of DESIGN_CATEGORIES) {
      const [a, b] = planConcepts(category);
      expect(a.lead, category).not.toBe(b.lead);
      expect(a.instruction).not.toBe(b.instruction);
    }
  });

  it("finds a third lead for a regenerated direction where the playbook has one", () => {
    const [a, b] = planConcepts("event");
    const c = regenerationConcept("event");
    expect([a.lead, b.lead]).not.toContain(c.lead);
  });
});
