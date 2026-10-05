import { describe, expect, it } from "vitest";
import { DESIGN_FORMATS, formatRules } from "@/lib/design/formats";
import {
  BRIEF_STRUCTURES,
  briefSectionsFor,
  briefStructureFor,
  sectionNamesFor,
} from "./brief-structures";

/* KOOS-AI-001, the ticket's second acceptance criterion: "Brief structure
   changes appropriately for each deliverable rather than using one
   social-media-flyer template for everything."

   BRIEF_STRUCTURES offered four templates and told the model to pick, with
   post, flyer, banner, story and ad collapsed into one. A thumbnail brief and
   a flyer brief came out of the same mould. The sections are module 01 §2's
   required-content list and §3's four content levels — primary, secondary,
   action, utility — specialised per format, plus module 05 §1-2's footer
   ordering. They are not a list invented here. */
describe("briefStructureFor", () => {
  it("gives every format a structure", () => {
    for (const format of DESIGN_FORMATS) {
      expect(briefStructureFor(format).trim().length).toBeGreaterThan(0);
      expect(sectionNamesFor(format).length).toBeGreaterThan(2);
    }
  });

  /* The criterion is "appropriately for each deliverable", so no two formats
     may share a section set — and a rename is not a difference. An earlier
     pass shipped `other` byte-identical to `flyer` and `poster` as `flyer`
     with one heading renamed, while the only test compared the three formats
     the rubric happened to name. */
  it("gives no two formats the same section set", () => {
    const bySignature = new Map<string, string[]>();
    for (const format of DESIGN_FORMATS) {
      const signature = sectionNamesFor(format).join("|");
      bySignature.set(signature, [
        ...(bySignature.get(signature) ?? []),
        format,
      ]);
    }
    const shared = [...bySignature.values()].filter(
      (formats) => formats.length > 1,
    );
    expect(shared).toEqual([]);
  });

  /* A rename passes the test above and changes nothing real. Two formats that
     differ by one heading out of eight are the same template. */
  it("makes each format differ from every other by more than one heading", () => {
    for (const a of DESIGN_FORMATS) {
      for (const b of DESIGN_FORMATS) {
        if (a === b) continue;
        const left = new Set(sectionNamesFor(a));
        const right = new Set(sectionNamesFor(b));
        const onlyLeft = [...left].filter((name) => !right.has(name));
        const onlyRight = [...right].filter((name) => !left.has(name));
        expect(
          onlyLeft.length + onlyRight.length,
          `${a} vs ${b}: only ${a}=${onlyLeft} only ${b}=${onlyRight}`,
        ).toBeGreaterThan(1);
      }
    }
  });

  /* Module 05 §1: a footer exists to carry contact details, address, handles
     and terms. A flyer's dates and venue are information, so the flyer brief
     asks for them in their own section; a thumbnail at 300px cannot carry a
     phone number and must not ask for one. */
  it("asks a flyer for utility details and a thumbnail for none", () => {
    expect(sectionNamesFor("flyer")).toContain("Utility Details");
    expect(sectionNamesFor("thumbnail")).not.toContain("Utility Details");
  });

  /* The renderer gained a footer band, and the social post is the format it
     draws most often. Without a feeder section the spec step has to invent the
     footer's contents — the inverse of the `bodyPoints` failure, a capability
     with nothing supplying it. */
  it("gives the social post a section that feeds the footer", () => {
    expect(sectionNamesFor("social-post")).toContain("Footer Content");
  });

  /* A thumbnail is read at a few hundred pixels. Supporting copy there is
     wasted ink, and asking for it invites the designer to add it. */
  it("does not ask a thumbnail for supporting copy", () => {
    expect(sectionNamesFor("thumbnail")).not.toContain("Supporting Copy");
    expect(sectionNamesFor("social-post")).toContain("Supporting Copy");
  });

  /* The renderer produces one still frame. A deck, a logo, a dieline or a
     screen is not that, and formats.ts already knows it. The brief has to say
     so in the brief itself — a silent substitution is how a user ends up with
     a poster when they asked for packaging.

     Asserted on the section LIST, not on the rendered prompt: the prompt's
     closing sentence used to name the section too, so the assertion passed
     with the heading deleted from every format. */
  it("declares a production-note section for every format the renderer cannot produce", () => {
    for (const format of DESIGN_FORMATS) {
      const declared = sectionNamesFor(format).includes("Production Note");
      expect(declared, format).toBe(!formatRules(format).generatable);
    }
  });

  /* The closing sentence must not name the section either, or the test above
     stops proving anything. */
  it("names the production-note section exactly once in the prompt", () => {
    const occurrences =
      briefStructureFor("motion").match(/Production Note/g)?.length ?? 0;
    expect(occurrences).toBe(1);
  });

  /* Carousels, decks, interfaces and motion are sequences; a single-frame
     template cannot hold them. */
  it("asks multi-page formats for per-page content", () => {
    for (const format of DESIGN_FORMATS) {
      if (!formatRules(format).multiPage) continue;
      expect(
        sectionNamesFor(format).some((name) =>
          /(Slide|Screen|Page|Frame)-by-/.test(name),
        ),
        format,
      ).toBe(true);
    }
  });

  /* Every section's guidance reaches the prompt. A heading with no `asks`
     would be a section the model has to guess the purpose of. */
  it("renders every section with its guidance", () => {
    for (const format of DESIGN_FORMATS) {
      const rendered = briefStructureFor(format);
      for (const section of briefSectionsFor(format)) {
        expect(section.asks.trim().length).toBeGreaterThan(10);
        expect(rendered).toContain(`**${section.name}** — ${section.asks}`);
      }
    }
  });

  /* The calendar brief writer drafts a chunk of slots whose formats differ
     from each other in one call, so no single structure can serve that
     prompt. Deleting the multi-template block would silently degrade it. */
  it("leaves the multi-template block intact for the calendar writer", () => {
    expect(BRIEF_STRUCTURES).toMatch(/CAROUSEL:/);
    expect(BRIEF_STRUCTURES).toMatch(/VIDEO:/);
  });
});
