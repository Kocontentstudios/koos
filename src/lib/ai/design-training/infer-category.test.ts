import { describe, expect, it } from "vitest";
import { inferCategory } from "./infer-category";

/* KOOS-AI-001 §1.1. The chat path can be asked for a category outright, but
   the form and quick-request paths never call a model — they still need a
   playbook, so the category is inferred from the words the user wrote. A wrong
   guess costs a worse playbook, never a wrong fact, so this leans on strong
   signals and falls back rather than reaching. */
describe("inferCategory", () => {
  it.each([
    ["Launch post for our new jollof spice jar, 250g", "product"],
    ["We clean offices in Lekki, book a visit", "service"],
    ["Webinar on Thursday 7pm with speaker Dr Ada", "event"],
    ["We are hiring a senior backend engineer, apply by Friday", "recruitment"],
    ["Admission is open for JSS1, apply before September", "education"],
    ["Fresh meat pies, order now for delivery", "food"],
    ["New wireless earbuds with 30-hour battery", "technology"],
    ["Send money home with zero fees on our app", "finance"],
    ["Happy new month from all of us", "celebration"],
    ["3 lessons I learned scaling a team — Tolu, CEO", "personal-brand"],
    ["5 tips for better sleep, a short guide", "educational"],
    ["50% off this weekend only, use code SAVE50", "offer"],
  ])("reads %s as %s", (text, expected) => {
    expect(inferCategory(text)).toBe(expected);
  });

  /* A discount on food is still an offer: the thing being communicated is the
     deal, and the offer playbook leads with it. The manual's priority order is
     what makes this the right call. */
  it("prefers the offer playbook when a discount leads the message", () => {
    expect(inferCategory("30% off all pastries this Friday, order now")).toBe(
      "offer",
    );
  });

  it("uses the design type as a secondary signal", () => {
    expect(inferCategory("Join us", "Event Graphic")).toBe("event");
  });

  /* "product" is the most common commercial case and the least wrong default:
     its priority order (subject → benefit → CTA → utility) is close to the
     cross-playbook rule the manual states for every category. */
  it.each(["", "   ", "Something for the socials"])(
    "falls back to product for %s",
    (text) => {
      expect(inferCategory(text)).toBe("product");
    },
  );

  it("is not confused by a brand name that contains a category word", () => {
    expect(
      inferCategory("Foodie Tech Ltd is hiring a product manager, apply now"),
    ).toBe("recruitment");
  });
});
