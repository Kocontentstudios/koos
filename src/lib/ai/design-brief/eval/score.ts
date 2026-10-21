import { placeholdersIn, suspectNumbersIn, words } from "@/lib/ai/eval-text";
import {
  briefSectionsFor,
  sectionNamesFor,
} from "@/lib/ai/prompts/brief-structures";
import {
  type DesignFormat,
  formatRules,
  resolveDesignFormat,
} from "@/lib/design/formats";

/**
 * Deterministic scoring for the two-step brief generator.
 *
 * Every question here has one correct answer given the output, so none of it
 * goes to a judge: whether the identified label resolves to the format the
 * request asked for, whether the required headings are present, whether the
 * headline fits the format's budget, and whether a fact nobody supplied was
 * invented rather than marked.
 *
 * What it deliberately does NOT score: whether the brief is any good. A
 * designer reads it for that.
 */

export interface BriefCaseExpectation {
  id: string;
  /** What the user asked for, as the conversation the step actually reads. */
  conversation: string;
  /** The format the label must resolve to. The label itself is free text, so
   *  "Video Thumbnail" and "YouTube thumbnail" are both correct answers. */
  expectedFormat: DesignFormat;
  /** Headings the routed structure requires. */
  requiredSections: string[];
  /** Headings this format must NOT ask for — a thumbnail has no room for a
   *  footer, and asking is an invitation to fill it. */
  forbiddenSections: string[];
  /** True when the conversation asks for a detail it never supplies, so the
   *  brief has to hand the designer the gap instead of a plausible value. */
  expectsGap?: boolean;
}

export interface BriefScore {
  id: string;
  formatCorrect: boolean;
  resolvedFormat: DesignFormat;
  missingSections: string[];
  forbiddenPresent: string[];
  /** Headings that appear before a heading the format declares earlier. */
  outOfOrder: string[];
  headlineWords: number;
  headlineBudget: number;
  withinBudget: boolean;
  gapAcknowledged: boolean;
  suspectNumbers: string[];
  productionNoteWhenNeeded: boolean;
  slidesCoherent: boolean;
}

/* Headings are matched against the names the format DECLARES, never guessed
   from the markup. A reader that treats any bold run as a heading cannot tell
   `**Headline**` from a model bolding its own headline copy, and a reader
   anchored on `**` immediately followed by the word misses `**1. Headline**`.
   Both misreadings were measured: the first scored a correct brief at zero
   words, the second reported present headings as missing. */
function headingPattern(heading: string): RegExp {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /* Three things, each learned from a measured misreading:
     - a real heading MARKER is required (`**` or an ATX `#`), because making it
       optional turned any body line beginning with the word into a heading —
       "Copy must be short" scored as print-collateral's Copy section;
     - anchored at the start of a line, so a heading named inside a sentence,
       a contents list, or prose about another section does not bind;
     - the name must END the heading text. Without that, "Action" matched the
       poster's own "Action & Access" and reported a foreign section on a
       correct brief.
     A numbering the model added itself is allowed between the two. */
  return new RegExp(
    `^[ \\t>]*(?:#{1,6}\\s*|\\*\\*)\\s*(?:\\(?\\d+\\)?[.):]\\s*|section\\s+\\d+[:.]\\s*)?${escaped}\\b(?=\\s*(?:\\*\\*|[:\\u2014\\u2013-]|$))(?::)?(?:\\s*\\*\\*)?`,
    "im",
  );
}

/* Fenced blocks are quoted material, not structure. A heading name inside one
   is an example, and a scorer that binds to it reads the example as the
   section. */
function withoutCodeFences(markdown: string): string {
  return markdown.replace(/^```[\s\S]*?^```/gm, "");
}

export function hasHeading(markdown: string, heading: string): boolean {
  return headingPattern(heading).test(withoutCodeFences(markdown));
}

/**
 * Whether the brief carries this heading as a SECTION of its own.
 *
 * A section stands alone on its line; a field within a section carries its
 * value on the same line. The distinction is the only one that separates a
 * borrowed template section from legitimate nested copy, and it is real
 * output: a correct carousel brief writes `**Headline:** …` and `**Body:** …`
 * once per slide inside Slide-by-Slide Copy, and a check that only asked
 * "does the word Headline appear as a heading" called that a flyer section
 * leaking into a carousel.
 *
 * Used for the forbidden set only. A required section is read with the
 * permissive form, because a model may legitimately put a real section's short
 * answer on the heading line.
 */
export function hasTopLevelHeading(markdown: string, heading: string): boolean {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^[ \\t>]*(?:#{1,6}\\s*|\\*\\*)\\s*(?:\\(?\\d+\\)?[.):]\\s*|section\\s+\\d+[:.]\\s*)?${escaped}\\b\\s*(?:\\*\\*)?\\s*$`,
    "im",
  ).test(withoutCodeFences(markdown));
}

/**
 * The declared headings, in the order they appear in the brief.
 *
 * Order is the substance of the criterion, not decoration: the prompt says "in
 * this order" and modules 01 §3 and 05 §2 ARE orderings — the four content
 * levels and the footer's priority. A brief with all eight headings reversed
 * satisfied every other measure here.
 */
export function headingOrder(markdown: string, format: DesignFormat): string[] {
  const body = withoutCodeFences(markdown);
  return sectionNamesFor(format)
    .map((name) => ({ name, at: headingPattern(name).exec(body)?.index }))
    .filter(
      (found): found is { name: string; at: number } => found.at !== undefined,
    )
    .sort((a, b) => a.at - b.at)
    .map((found) => found.name);
}

/**
 * The body under one of the format's declared headings.
 *
 * Bounded by the next DECLARED heading rather than by the next bold run, so
 * emphasis inside a section cannot truncate it. The guidance the prompt
 * attaches to each heading is stripped when the model echoes it, because a
 * brief that repeats "the exact words, verbatim" has not written a
 * seven-word headline.
 */
export function sectionBody(
  markdown: string,
  heading: string,
  format: DesignFormat,
): string {
  const body0 = withoutCodeFences(markdown);
  const match = headingPattern(heading).exec(body0);
  if (!match) return "";
  const body = body0;

  const after = body.slice(match.index + match[0].length);
  const others = sectionNamesFor(format).filter(
    (name) => name.toLowerCase() !== heading.toLowerCase(),
  );
  const boundary = others
    .map((name) => headingPattern(name).exec(after)?.index)
    .filter((index): index is number => index !== undefined);
  const section = after.slice(
    0,
    boundary.length > 0 ? Math.min(...boundary) : undefined,
  );

  const withoutSeparator = section.replace(
    /^[ \t]*[:\u2014\u2013-]+[ \t]*/,
    "",
  );
  return stripEchoedGuidance(withoutSeparator, heading, format).trim();
}

/* Only an exact echo is removed: the first four words of the guidance this
   prompt wrote for that heading. Anything else the model put there is its own
   and counts. */
function stripEchoedGuidance(
  body: string,
  heading: string,
  format: DesignFormat,
): string {
  const asks = briefSectionsFor(format).find(
    (section) => section.name.toLowerCase() === heading.toLowerCase(),
  )?.asks;
  if (!asks) return body;

  const opening = asks.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
  const [firstLine, ...rest] = body.split("\n");
  return firstLine.trim().toLowerCase().startsWith(opening)
    ? rest.join("\n")
    : body;
}

/* A heading with nothing under it is not a limitation statement. The prompt
   tells the model to write every heading even where the answer is short, so
   "**Production Note** — none needed" satisfies heading presence while
   claiming the renderer can do something it cannot. */
/* Matched against the WHOLE body, not its opening. Start-anchored, a real
   limitation statement that begins "None of what the automated renderer
   produces is print-ready…" scored as an empty section and failed the lane. */
const NO_CONTENT =
  /^(none|n\/?a|nil|not (needed|applicable|required))\b[\s.!-]*$/i;

function statesSomething(body: string): boolean {
  return words(body) >= 5 && !NO_CONTENT.test(body.trim());
}

/* A brief is read by a human designer, so a gap belongs in words — "phone
   number to be supplied" — as readily as in a `[PHONE NUMBER]` token. The
   bracketed form is the DESIGN SPEC's convention, because there the text is
   drawn onto the image; requiring it here measured the wrong convention and
   scored correct output as a miss. What matters either way is that the gap
   reached the designer and no number was invented to fill it. */
const GAP_LANGUAGE =
  /\b(to be (supplied|provided|confirmed)|not (yet )?(supplied|provided|stated|given|confirmed|available)|client to (supply|provide|confirm)|awaiting|TBC|TBD|to confirm|missing from the (brief|request)|needs? to be (supplied|provided|confirmed))\b/i;

export function acknowledgesGap(markdown: string): boolean {
  return placeholdersIn(markdown).length > 0 || GAP_LANGUAGE.test(markdown);
}

/* The declared order, compared against the order found. Names every heading
   that arrived before one the format puts ahead of it, so the failure says
   WHICH section moved rather than only that something did. */
export function outOfOrderSections(
  markdown: string,
  format: DesignFormat,
): string[] {
  const declared = sectionNamesFor(format);
  const found = headingOrder(markdown, format);
  const rank = new Map(declared.map((name, index) => [name, index]));

  const misplaced: string[] = [];
  let highest = -1;
  for (const name of found) {
    const position = rank.get(name) ?? -1;
    if (position < highest) misplaced.push(name);
    else highest = position;
  }
  return misplaced;
}

export function scoreBriefCase(
  expectation: BriefCaseExpectation,
  produced: {
    designType: string;
    slides: number;
    briefMarkdown: string;
  },
): BriefScore {
  const resolvedFormat = resolveDesignFormat(produced.designType);
  const rules = formatRules(resolvedFormat);
  const markdown = produced.briefMarkdown;

  /* The headline heading differs by format, so the budget is measured against
     whichever primary-copy section this format declares. */
  /* Only read where the format declares the section. A carousel has no
     Headline of its own — each slide carries its copy — and searching the raw
     markdown found a slide's internal heading and measured 189 words against
     the carousel's seven-word budget. Measured in a real run; the brief was
     correct and the instrument was not. */
  const headlineRequired = sectionNamesFor(resolvedFormat).some((name) =>
    /^headline$/i.test(name),
  );
  const headline = headlineRequired
    ? sectionBody(markdown, "Headline", resolvedFormat)
    : "";

  return {
    id: expectation.id,
    formatCorrect: resolvedFormat === expectation.expectedFormat,
    resolvedFormat,
    missingSections: expectation.requiredSections.filter(
      (section) => !hasHeading(markdown, section),
    ),
    forbiddenPresent: expectation.forbiddenSections.filter((section) =>
      hasTopLevelHeading(markdown, section),
    ),
    outOfOrder: outOfOrderSections(markdown, resolvedFormat),
    headlineWords: words(headline),
    headlineBudget: rules.headlineWords,
    /* Slack of two: the prompt says "roughly", and failing a brief for a
       nine-word headline against an eight-word budget would be measuring the
       instruction's wording rather than the model's judgement.
       An absent headline is not "within budget" where the format asked for
       one — a zero-word reading has to fail, or the measure rewards the brief
       that skipped the section entirely. A carousel declares no headline
       section at all, so there it is genuinely not applicable. */
    withinBudget: headlineRequired
      ? words(headline) > 0 && words(headline) <= rules.headlineWords + 2
      : words(headline) <= rules.headlineWords + 2,
    gapAcknowledged: acknowledgesGap(markdown),
    suspectNumbers: suspectNumbersIn(markdown),
    productionNoteWhenNeeded:
      rules.generatable ||
      statesSomething(sectionBody(markdown, "Production Note", resolvedFormat)),
    /* A format that is a sequence needs a slide count, and one that is a
       single frame must not carry one. */
    slidesCoherent: rules.multiPage
      ? produced.slides >= 2
      : produced.slides < 2,
  };
}

export interface BriefTotals {
  formatCorrect: number;
  structureClean: number;
  withinBudget: number;
  productionNotes: number;
  slidesCoherent: number;
  inventedNumbers: string[];
  unacknowledgedGaps: string[];
}

export function aggregateBriefs(
  scores: BriefScore[],
  expectations: BriefCaseExpectation[],
): BriefTotals {
  const share = (predicate: (s: BriefScore) => boolean) =>
    scores.length === 0 ? 0 : scores.filter(predicate).length / scores.length;

  const expectationById = new Map(expectations.map((e) => [e.id, e]));

  return {
    formatCorrect: share((s) => s.formatCorrect),
    structureClean: share(
      (s) =>
        s.missingSections.length === 0 &&
        s.forbiddenPresent.length === 0 &&
        s.outOfOrder.length === 0,
    ),
    withinBudget: share((s) => s.withinBudget),
    productionNotes: share((s) => s.productionNoteWhenNeeded),
    slidesCoherent: share((s) => s.slidesCoherent),
    /* Only counted where nothing was supplied to begin with: a brief that
       repeats a number the user gave is correct, not invented. */
    inventedNumbers: scores
      .filter((s) => expectationById.get(s.id)?.expectsGap)
      .flatMap((s) => s.suspectNumbers),
    unacknowledgedGaps: scores
      .filter(
        (s) => expectationById.get(s.id)?.expectsGap && !s.gapAcknowledged,
      )
      .map((s) => s.id),
  };
}

export interface BriefThresholds {
  minFormatCorrect: number;
  minStructureClean: number;
  minWithinBudget: number;
  minProductionNotes: number;
  minSlidesCoherent: number;
}

export function briefsPassed(
  totals: BriefTotals,
  thresholds: BriefThresholds,
): boolean {
  return (
    totals.formatCorrect >= thresholds.minFormatCorrect &&
    totals.structureClean >= thresholds.minStructureClean &&
    totals.withinBudget >= thresholds.minWithinBudget &&
    totals.productionNotes >= thresholds.minProductionNotes &&
    totals.slidesCoherent >= thresholds.minSlidesCoherent &&
    /* Neither is a share. One invented phone number on a design that reaches a
       client is the failure this whole lane exists to catch, and a gap the
       brief never mentions is the same failure one step earlier — the
       designer does not know to ask. */
    totals.inventedNumbers.length === 0 &&
    totals.unacknowledgedGaps.length === 0
  );
}
