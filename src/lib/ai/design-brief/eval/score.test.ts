import { describe, expect, it } from "vitest";
import {
  acknowledgesGap,
  aggregateBriefs,
  type BriefCaseExpectation,
  briefsPassed,
  hasHeading,
  hasTopLevelHeading,
  outOfOrderSections,
  scoreBriefCase,
  sectionBody,
} from "./score";

const flyerCase: BriefCaseExpectation = {
  id: "flyer",
  conversation: "user: flyer for the launch, put our number on it",
  expectedFormat: "flyer",
  requiredSections: ["Headline", "Utility Details"],
  forbiddenSections: ["Focal Subject"],
  expectsGap: true,
};

/* A scorer that misreads its own instrument is worse than none: the first
   version of the design-spec benchmark read three of four copy fields and
   reported a win as a miss, which nearly sent that investigation the wrong
   way. These tests exist to stop the same thing happening here. */
describe("sectionBody", () => {
  const markdown = [
    "**Request Title**",
    "",
    "Launch Flyer",
    "",
    "**Headline**",
    "",
    "Doors Open Friday",
    "",
    "**Utility Details**",
    "",
    "Call [PHONE NUMBER]",
  ].join("\n");

  it("reads the body under a heading and stops at the next one", () => {
    expect(sectionBody(markdown, "Headline", "flyer")).toBe(
      "Doors Open Friday",
    );
  });

  it("reads a heading that carries its value on the same line", () => {
    expect(
      sectionBody("**Headline:** Doors Open Friday", "Headline", "flyer"),
    ).toBe("Doors Open Friday");
  });

  /* Each of the four shapes below was measured misreading the brief before the
     scorer was anchored on the format's declared headings. */
  it("strips the guidance the prompt attached, not the copy after it", () => {
    expect(
      sectionBody(
        "**Headline** — the exact words, verbatim\n\nDoors Open Friday",
        "Headline",
        "flyer",
      ),
    ).toBe("Doors Open Friday");
  });

  /* The old reader dropped everything before the first blank line, so a
     twenty-word headline followed by a note measured as the note — two words,
     inside any budget. */
  it("keeps same-line copy when a second paragraph follows", () => {
    expect(
      sectionBody(
        "**Headline:** Doors open Friday the thirteenth at six in the evening sharp\n\nAlternative: Doors Friday",
        "Headline",
        "flyer",
      ),
    ).toBe(
      "Doors open Friday the thirteenth at six in the evening sharp\n\nAlternative: Doors Friday",
    );
  });

  /* The whole prompt is written in bold, so a model bolding its own headline
     is ordinary. Bounding on the next bold run measured this as empty and
     failed a correct brief. */
  it("is not truncated by emphasis inside the section", () => {
    expect(
      sectionBody(
        '**Headline**\n\n**"Egusi in 20 minutes"**\n\n**Utility Details**\n\nCall us',
        "Headline",
        "flyer",
      ),
    ).toBe('**"Egusi in 20 minutes"**');
  });

  it("finds a numbered heading", () => {
    expect(
      sectionBody("**1. Headline**\n\nDoors Open Friday", "Headline", "flyer"),
    ).toBe("Doors Open Friday");
    expect(hasHeading("**1. Headline**", "Headline")).toBe(true);
  });

  it("returns empty for a heading that is not there", () => {
    expect(sectionBody(markdown, "Caption", "flyer")).toBe("");
  });
});

describe("scoreBriefCase", () => {
  it("resolves the format from the label rather than demanding one spelling", () => {
    const score = scoreBriefCase(flyerCase, {
      designType: "E-Flyer",
      slides: 0,
      briefMarkdown:
        "**Headline**\n\nOpen Friday\n\n**Utility Details**\n\nCall us",
    });
    expect(score.formatCorrect).toBe(true);
    expect(score.resolvedFormat).toBe("flyer");
  });

  it("names the sections the brief skipped and the ones it should not have", () => {
    const score = scoreBriefCase(flyerCase, {
      designType: "Flyer",
      slides: 0,
      briefMarkdown:
        "**Headline**\n\nOpen Friday\n\n**Focal Subject**\n\nA face",
    });
    expect(score.missingSections).toEqual(["Utility Details"]);
    expect(score.forbiddenPresent).toEqual(["Focal Subject"]);
  });

  /* Four words is the thumbnail budget; the slack of two is deliberate, so a
     six-word headline passes and a seven-word one does not. */
  it("measures the headline against the resolved format's budget", () => {
    const thumbnail: BriefCaseExpectation = {
      ...flyerCase,
      expectedFormat: "thumbnail",
      requiredSections: [],
      forbiddenSections: [],
    };
    const six = scoreBriefCase(thumbnail, {
      designType: "Video Thumbnail",
      slides: 0,
      briefMarkdown: "**Headline**\n\nOne two three four five six",
    });
    expect(six.headlineBudget).toBe(4);
    expect(six.withinBudget).toBe(true);

    const seven = scoreBriefCase(thumbnail, {
      designType: "Video Thumbnail",
      slides: 0,
      briefMarkdown: "**Headline**\n\nOne two three four five six seven",
    });
    expect(seven.withinBudget).toBe(false);
  });

  describe("production note", () => {
    const packaging: BriefCaseExpectation = {
      ...flyerCase,
      expectedFormat: "print-collateral",
      requiredSections: [],
      forbiddenSections: [],
    };
    const score = (briefMarkdown: string) =>
      scoreBriefCase(packaging, {
        designType: "Packaging",
        slides: 0,
        briefMarkdown,
      }).productionNoteWhenNeeded;

    it("is not required where the renderer can deliver", () => {
      expect(
        scoreBriefCase(flyerCase, {
          designType: "Flyer",
          slides: 0,
          briefMarkdown: "**Headline**\n\nOpen Friday",
        }).productionNoteWhenNeeded,
      ).toBe(true);
    });

    it("fails when the section is absent", () => {
      expect(score("**Copy**\n\nLabel text")).toBe(false);
    });

    /* The heading alone is what the first version checked. The prompt tells
       the model to write every heading even where the answer is short, so
       heading presence was satisfied by a brief that claimed the renderer
       could produce a printed label. */
    it("fails a heading that says the section is not needed", () => {
      expect(
        score("**Copy**\n\nLabel text\n\n**Production Note**\n\nNone needed."),
      ).toBe(false);
      expect(
        score("**Copy**\n\nLabel text\n\n**Production Note**\n\nN/A"),
      ).toBe(false);
    });

    it("passes a real limitation statement", () => {
      expect(
        score(
          "**Copy**\n\nLabel text\n\n**Production Note**\n\nPrint needs bleed, trim marks and a CMYK dieline, so the automated renderer cannot produce the final artefact.",
        ),
      ).toBe(true);
    });
  });

  it("treats a slide count as coherent only for a sequence", () => {
    const carousel: BriefCaseExpectation = {
      ...flyerCase,
      expectedFormat: "carousel",
      requiredSections: [],
      forbiddenSections: [],
    };
    expect(
      scoreBriefCase(carousel, {
        designType: "Carousel",
        slides: 5,
        briefMarkdown: "**Slide 1**\n\nHook",
      }).slidesCoherent,
    ).toBe(true);
    expect(
      scoreBriefCase(carousel, {
        designType: "Carousel",
        slides: 0,
        briefMarkdown: "**Slide 1**\n\nHook",
      }).slidesCoherent,
    ).toBe(false);
    expect(
      scoreBriefCase(flyerCase, {
        designType: "Flyer",
        slides: 4,
        briefMarkdown: "**Headline**\n\nOpen",
      }).slidesCoherent,
    ).toBe(false);
  });
});

describe("aggregateBriefs", () => {
  const marked = scoreBriefCase(flyerCase, {
    designType: "Flyer",
    slides: 0,
    briefMarkdown:
      "**Headline**\n\nOpen Friday\n\n**Utility Details**\n\nCall [PHONE NUMBER]",
  });
  const invented = scoreBriefCase(flyerCase, {
    designType: "Flyer",
    slides: 0,
    briefMarkdown:
      "**Headline**\n\nOpen Friday\n\n**Utility Details**\n\nCall 0800 000 0000",
  });

  it("counts an invented number only where nothing was supplied", () => {
    expect(aggregateBriefs([invented], [flyerCase]).inventedNumbers).toEqual([
      "0800 000 0000",
    ]);
    expect(
      aggregateBriefs([invented], [{ ...flyerCase, expectsGap: false }])
        .inventedNumbers,
    ).toEqual([]);
  });

  it("names the cases that neither handed over the gap nor filled it", () => {
    const silent = scoreBriefCase(flyerCase, {
      designType: "Flyer",
      slides: 0,
      briefMarkdown:
        "**Headline**\n\nOpen Friday\n\n**Utility Details**\n\nnone",
    });
    expect(aggregateBriefs([silent], [flyerCase]).unacknowledgedGaps).toEqual([
      "flyer",
    ]);
    expect(aggregateBriefs([marked], [flyerCase]).unacknowledgedGaps).toEqual(
      [],
    );
  });

  /* One invented number fails the run outright. It is not a share, because a
     single plausible phone number on a design a client publishes is the whole
     reason the missing-information rule exists. */
  it("fails a run with any invented number, however good the rest", () => {
    const thresholds = {
      minFormatCorrect: 1,
      minStructureClean: 1,
      minWithinBudget: 1,
      minProductionNotes: 1,
      minSlidesCoherent: 1,
    };
    expect(
      briefsPassed(aggregateBriefs([marked], [flyerCase]), thresholds),
    ).toBe(true);
    expect(
      briefsPassed(aggregateBriefs([invented], [flyerCase]), thresholds),
    ).toBe(false);
  });

  it("scores an empty run as zero rather than dividing by nothing", () => {
    expect(aggregateBriefs([], []).formatCorrect).toBe(0);
  });
});

/* The brief is read by a designer, not drawn by the renderer, so prose that
   hands over the gap is as correct as a bracketed token. Requiring the token
   was the design-spec convention applied to the wrong artefact, and it scored
   the first real eval run's correct output as a miss. */
describe("acknowledgesGap", () => {
  it.each([
    "Call [PHONE NUMBER] to pre-order",
    "Phone number to be supplied by the client",
    "Contact number: TBC",
    "The venue is not yet confirmed",
    "Client to provide the WhatsApp line",
    "Phone number missing from the brief",
  ])("accepts %s", (text) => {
    expect(acknowledgesGap(text)).toBe(true);
  });

  it.each([
    "Call 0800 000 0000 to pre-order",
    "Contact us on social media",
    "**Utility Details**\n\nnone",
  ])("rejects %s", (text) => {
    expect(acknowledgesGap(text)).toBe(false);
  });
});

/* A format that declares a headline section and then has none is not "within
   budget" at zero words — that reading rewards the brief that skipped it. */
describe("headline budget with no headline", () => {
  it("fails a required headline that is absent", () => {
    expect(
      scoreBriefCase(flyerCase, {
        designType: "Flyer",
        slides: 0,
        briefMarkdown: "**Utility Details**\n\nCall [PHONE NUMBER]",
      }).withinBudget,
    ).toBe(false);
  });

  it("does not demand one from a format that declares none", () => {
    expect(
      scoreBriefCase(
        {
          ...flyerCase,
          expectedFormat: "carousel",
          requiredSections: ["Slide 1"],
          forbiddenSections: [],
        },
        {
          designType: "Carousel",
          slides: 5,
          briefMarkdown: "**Slide 1**\n\nHow we make egusi",
        },
      ).withinBudget,
    ).toBe(true);
  });
});

/* Measured in a real run: a carousel brief scored 189 words against a
   seven-word budget because the scorer searched the raw markdown for a
   Headline the carousel format never declares and found one inside a slide. */
describe("headline measurement scope", () => {
  it("does not measure a headline a format never declares", () => {
    const score = scoreBriefCase(
      {
        id: "carousel",
        conversation: "",
        expectedFormat: "carousel",
        requiredSections: [],
        forbiddenSections: [],
      },
      {
        designType: "Carousel",
        slides: 4,
        briefMarkdown:
          "**Slide-by-Slide Copy**\n\nSlide 1 — **Headline:** a very long internal line that would blow any budget at all if it were measured",
      },
    );
    expect(score.headlineWords).toBe(0);
    expect(score.withinBudget).toBe(true);
  });
});

/* Round-2 review: order is the substance of the criterion, not decoration. The
   prompt says "in this order" twice, and modules 01 §3 and 05 §2 ARE
   orderings. A flyer brief with all eight headings reversed satisfied every
   other measure in this file. */
describe("outOfOrderSections", () => {
  const inOrder = [
    "**Request Title**\n\nLaunch",
    "**Objective**\n\nSell",
    "**Headline**\n\nOpen Friday",
    "**Supporting Copy**\n\nFresh daily",
    "**Utility Details**\n\nLekki",
    "**Call-to-Action**\n\nPre-order",
    "**Visual Direction**\n\nTrays",
    "**Branding Requirements**\n\nGreen",
  ].join("\n\n");

  it("finds nothing wrong with the declared order", () => {
    expect(outOfOrderSections(inOrder, "flyer")).toEqual([]);
  });

  it("names the section that moved", () => {
    const swapped = inOrder.replace(
      "**Headline**\n\nOpen Friday\n\n**Supporting Copy**\n\nFresh daily",
      "**Supporting Copy**\n\nFresh daily\n\n**Headline**\n\nOpen Friday",
    );
    expect(outOfOrderSections(swapped, "flyer")).toEqual(["Headline"]);
  });

  it("catches a brief that reversed every heading", () => {
    const reversed = inOrder.split("\n\n").reverse().join("\n\n");
    expect(outOfOrderSections(reversed, "flyer").length).toBeGreaterThan(3);
  });

  it("ignores a section the brief never wrote", () => {
    expect(
      outOfOrderSections(
        "**Headline**\n\nOpen\n\n**Utility Details**\n\nLekki",
        "flyer",
      ),
    ).toEqual([]);
  });
});

/* Five further misreadings found in round-2 review, each demonstrated against
   markdown a real model produces. */
describe("heading matching robustness", () => {
  it("does not bind to a heading named inside a sentence", () => {
    const withContents = [
      "This brief covers the Headline and the Utility Details below.",
      "",
      "**Headline**",
      "",
      "Egusi in 20 minutes",
    ].join("\n");
    expect(sectionBody(withContents, "Headline", "flyer")).toBe(
      "Egusi in 20 minutes",
    );
  });

  it("ignores headings inside a fenced block", () => {
    const fenced = [
      "```",
      "**Headline** — example only",
      "Some other campaign entirely",
      "```",
      "",
      "**Headline**",
      "",
      "Egusi in 20 minutes",
    ].join("\n");
    expect(sectionBody(fenced, "Headline", "flyer")).toBe(
      "Egusi in 20 minutes",
    );
  });

  it.each([
    "**(1) Headline**",
    "**Section 3: Headline**",
    "## Headline",
    "**1. Headline**",
  ])("finds the heading written as %s", (heading) => {
    expect(hasHeading(`${heading}\n\nOpen Friday`, "Headline")).toBe(true);
    expect(sectionBody(`${heading}\n\nOpen Friday`, "Headline", "flyer")).toBe(
      "Open Friday",
    );
  });
});

/* A real limitation statement that opens with the word "None" is not an empty
   section, and start-anchored matching failed the whole lane for one. */
describe("production note substance, round 2", () => {
  const packaging = {
    id: "p",
    conversation: "",
    expectedFormat: "print-collateral" as const,
    requiredSections: [],
    forbiddenSections: [],
  };
  const score = (body: string) =>
    scoreBriefCase(packaging, {
      designType: "Packaging",
      slides: 0,
      briefMarkdown: `**Copy**\n\nLabel text\n\n**Production Note**\n\n${body}`,
    }).productionNoteWhenNeeded;

  it("accepts a statement that begins with the word None", () => {
    expect(
      score(
        "None of what the automated renderer produces is print-ready: there is no bleed, no trim and no CMYK separation.",
      ),
    ).toBe(true);
  });

  it("still rejects a bare none", () => {
    expect(score("None.")).toBe(false);
    expect(score("N/A")).toBe(false);
    expect(score("not needed")).toBe(false);
  });
});

/* Both measured against real model output in the round-3 eval run, where they
   dropped structureClean from 1.00 to 0.60 on briefs that were correct. */
describe("heading matching, round 3", () => {
  it("does not treat a body line beginning with a heading word as a heading", () => {
    const brief = [
      "**Headline**",
      "",
      "Doors Open Friday",
      "",
      "Copy must stay under eight words on this format.",
    ].join("\n");
    expect(hasHeading(brief, "Copy")).toBe(false);
  });

  /* "Action" is the `other` format's section; "Action & Access" is the
     poster's own. A name that matched as a prefix reported the poster as
     carrying a foreign section. */
  it("does not match a heading name that is only a prefix of the real heading", () => {
    expect(hasHeading("**Action & Access**\n\nQR at the gate", "Action")).toBe(
      false,
    );
    expect(
      hasHeading("**Action & Access**\n\nQR at the gate", "Action & Access"),
    ).toBe(true);
  });

  it("still matches every real heading shape", () => {
    for (const heading of [
      "**Headline**",
      "**Headline:**",
      "**Headline** — the exact words",
      "## Headline",
      "**1. Headline**",
    ]) {
      expect(hasHeading(`${heading}\n\nOpen Friday`, "Headline"), heading).toBe(
        true,
      );
    }
  });
});

/* A correct carousel brief writes `**Headline:** …` and `**Body:** …` once per
   slide inside Slide-by-Slide Copy. Measured: a forbidden-section check that
   only asked whether the word appeared as a heading called that a flyer
   section leaking into a carousel, and failed the lane. */
describe("hasTopLevelHeading", () => {
  it("ignores a field that carries its value on the same line", () => {
    const carousel = [
      "**Slide-by-Slide Copy**",
      "",
      "**Headline:** Your soup starts long before the pot",
      "**Body:** Swipe through for the full story.",
      "",
      "**Through-line**",
      "",
      "One palette across all five frames",
    ].join("\n");
    expect(hasTopLevelHeading(carousel, "Headline")).toBe(false);
    expect(hasTopLevelHeading(carousel, "Through-line")).toBe(true);
    /* The permissive reader still finds it, which is what the required-section
       and body checks need. */
    expect(hasHeading(carousel, "Headline")).toBe(true);
  });

  it("finds a borrowed section that does stand alone", () => {
    expect(
      hasTopLevelHeading(
        "**Slide 1**\n\nHook\n\n**Utility Details**\n\nLekki",
        "Utility Details",
      ),
    ).toBe(true);
  });

  it("accepts an ATX section heading", () => {
    expect(
      hasTopLevelHeading("## Utility Details\n\nLekki", "Utility Details"),
    ).toBe(true);
  });
});
