import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { MAX_FOOTER_LINES } from "@/lib/design/render/footer";
import {
  aboveRepeats,
  type BriefFact,
  contradictedDates,
  detailHeldAcross,
  type FactCopy,
  factStated,
  headlineFooterRepeats,
  headlineInTheWay,
  isFragment,
  redundantFooterItems,
  rivalledFacts,
  timeOnPhoneLine,
  withoutItem,
} from "./brief-facts";
import type { FactLedger } from "./claims";
import { copyFault } from "./finalize";
import { readsAsList } from "./footer-repeats";
import { COPY_LIMITS, COPY_TARGETS } from "./schema";
import { contentStems } from "./text-overlap";

/**
 * Model writes, code verifies (Oluwaseyi's ruling, round 7).
 *
 * When a direction leaves a brief fact out, or its footer holds a fragment
 * ("Two"), a time on a phone's line, or its subheadline reads as a list,
 * code used to write the fix itself: it appended the fact to the footer or
 * the subheadline, or labelled a bare item ("Phone: 8035550142"). That
 * printed fragments, glued hours to phones and turned subheadlines into
 * lists (round-6 critics). Now the model rewrites the subheadline and the
 * footer to carry what is missing, in its own sentences, and code checks
 * the result against the literal verifier (factStated) and the drawing
 * rules. The button is never rewritten here: it is the ask. The headline
 * is the idea and moves only when it stands in the way of a fact
 * (headlineInTheWay, round 8): then the model may write it again on the
 * same idea so the subheadline need not repeat it.
 */

export interface FactWriteRequest {
  /** The direction's index in its set. */
  id: number;
  copy: Pick<FactCopy, "headline" | "subheadline" | "cta" | "footerLines">;
  /** Brief facts, in the brief's words, the copy must state. */
  missing: string[];
  /** Every other fact the copy states now, which it must keep. */
  keep: string[];
  /** What else is wrong with the copy, in words. */
  problems: string[];
  /** The other designs' subheadlines, which this one must not echo: two
   *  rewrites of one brief came back as the same sentence (round-7 eval,
   *  fitness and fintech). */
  others?: string[];
  /** The other designs' own words, beyond the brief's: a rewrite that
   *  borrows them reads as the other design (round-8 eval, conference:
   *  a named speaker left off twice for "reads like the other design"). */
  avoid?: string[];
  /** The headline stands in the way of a fact (headlineInTheWay). */
  headlineMayChange?: boolean;
}

export interface FactWrite {
  id: number;
  /** Only for a request whose headline may change. */
  headline?: string;
  subheadline: string;
  footerLines: string[];
}

export type FactWriter = (input: {
  requests: FactWriteRequest[];
  briefText: string;
  title: string;
}) => Promise<FactWrite[] | null>;

const schema = z.object({
  rewrites: z
    .array(
      z.object({
        id: z.number(),
        headline: z.string().optional(),
        subheadline: z.string(),
        footerLines: z.array(z.string()),
      }),
    )
    .max(10),
});

export function buildFactWritePrompt({
  requests,
  briefText,
  title,
}: Parameters<FactWriter>[0]): string {
  return [
    "You edit the copy of social media designs for a small business. Each design below leaves out something its brief says, or has a footer problem. Rewrite its subheadline and its footer lines so it states everything listed, naturally, as a person would write it.",
    `The brief: ${briefText}`,
    title ? `Its title: ${title}` : null,
    [
      "Rules:",
      '- Never change the button. Leave the headline as it is, unless the design says "headline may change".',
      `- A design whose headline may change has a headline that already says part of a fact, so stating the fact below would repeat it (or a footer item already gives the headline's price or number again). Return a "headline" for it only if that is so: the same idea in other words that either states the whole fact itself or no longer says any of it, keeping at least one of the headline's own words, at most ${COPY_TARGETS.headline.chars} characters, and not the other design's headline. A headline that asks stays a question; one that hedges stays hedged. Then the subheadline says nothing the new headline says.`,
      '- State every fact listed under "must state", in the brief\'s words or with every part of it in one place: a price with its currency, amount and unit together ("₦18,000 per split unit", never "₦18,000" alone), and with the word the brief puts before it ("from ₦18,000 each", "starting at", "up to", "only", "just": "₦18,000 each" alone is another price); a count with its noun ("two senior React engineers", never "Two"); an offer, condition or requirement word for word as the brief writes it ("Free delivery to Lekki, Ajah and Ikoyi", "You need at least 2 years in a busy kitchen").',
      '- Keep every fact listed under "keep".',
      `- Put a fact in the subheadline when it reads naturally there, else in the footer. The subheadline is at most two sentences, about ${COPY_TARGETS.subheadline.chars} characters and never over ${COPY_LIMITS.subheadline}; never string clauses together with dashes, semicolons or full stops into a list. What does not fit that goes in the footer.`,
      "- Keep each design's own idea: its subheadline must not repeat or reorder another design's.",
      `- The footer is at most ${MAX_FOOTER_LINES} lines of at most 60 characters; items on one line are joined by " · ".`,
      '- Every footer item says what it is ("Call 0803 555 0142", "Open 9am to 4pm"); none is a bare number, time or word.',
      "- Never put a time or opening hours on the same footer line as a phone number.",
      '- Give each time, price, date and count a field of its own (the headline, the subheadline, the button, or one footer line). Two of a kind in one field read as a choice and state neither ("Doors 3pm, panel 4pm", "₦4,500 a slice, ₦30,000 the cake"); a range written whole ("6pm to 9pm") is one value. A count shares its field with no other count of what it counts, no bare number and no count offered as its alternative ("10 seats or 12 spots", "10 seats or 12 desks", "5 rows of 10 seats", "10 seats, or 12" state no count), but a number that counts something else, an age or an address beside it is fine ("10 seats · 18+", "Only 20 pieces · 12 Ozumba Mbadiwe Avenue"). A time shares its field with no other time and no bare number ("Doors 6, or 7pm", "7pm or 8" state no time), but a count of seats, people, stalls, pieces or hours, an age or an amount beside it is fine ("Class runs 2pm to 5pm · 10 seats", "Doors 7pm · 18+"), and any other number goes in its own field. A price shares its field with no other amount and no other large number unless "for" says what the price buys ("₦6,000 or 5,000", "Adults ₦6,000 · Kids 3,000" state no price; "₦6,000 for 10 people" does). A price or a date beside a time or a count is fine ("Thursday 20 November · 6pm to 9pm", "₦25,000 a seat · 10 seats").',
      "- No footer item repeats the headline, the subheadline, the button or another footer item, and the subheadline never says again a price, number, name or phrase the headline or button already says: leave that out of it.",
      '- Use only what the brief says. Add no fact, claim or quality of your own, and no word of scarcity or urgency the brief does not use ("only", "just", "hurry", "last chance").',
    ].join("\n"),
    requests
      .map((r) =>
        [
          `Design ${r.id}:`,
          `  headline: ${r.copy.headline}`,
          `  subheadline: ${r.copy.subheadline ?? "(none)"}`,
          r.copy.cta ? `  button: ${r.copy.cta}` : null,
          `  footer lines: ${
            r.copy.footerLines.length > 0
              ? r.copy.footerLines.map((l) => `"${l}"`).join(", ")
              : "(none)"
          }`,
          r.missing.length > 0
            ? `  must state: ${r.missing.map((m) => `"${m}"`).join(", ")}`
            : null,
          r.keep.length > 0
            ? `  keep: ${r.keep.map((m) => `"${m}"`).join(", ")}`
            : null,
          r.problems.length > 0 ? `  fix: ${r.problems.join("; ")}` : null,
          r.others && r.others.length > 0
            ? `  the other design's subheadline, not to echo: ${r.others.map((o) => `"${o}"`).join(", ")}`
            : null,
          r.avoid && r.avoid.length > 0
            ? `  the other design's own words, not to use: ${r.avoid.map((w) => `"${w}"`).join(", ")}`
            : null,
          r.headlineMayChange ? "  headline may change" : null,
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n"),
    'Return "rewrites": one entry per design with its id, "subheadline" and "footerLines", and "headline" only where it may change and you changed it.',
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const writeFacts: FactWriter = async (input) => {
  if (input.requests.length === 0) return [];
  try {
    const { object } = await generateObject({
      model: getModel("strategy"),
      schema,
      maxOutputTokens: 2000,
      prompt: buildFactWritePrompt(input),
    });
    const rewrites = (object as { rewrites?: unknown }).rewrites;
    if (!Array.isArray(rewrites)) return null;
    const asked = new Set(input.requests.map((r) => r.id));
    return rewrites.filter(
      (r): r is FactWrite =>
        typeof r?.id === "number" &&
        asked.has(r.id) &&
        typeof r.subheadline === "string" &&
        (r.headline === undefined || typeof r.headline === "string") &&
        Array.isArray(r.footerLines) &&
        r.footerLines.every((l: unknown) => typeof l === "string"),
    );
  } catch (err) {
    console.error("fact rewrite unavailable; leaving facts off", err);
    return null;
  }
};

function footerItemsOf(lines: readonly string[]): string[] {
  return lines.flatMap((line) =>
    line
      .split(/\s+[·•]\s+/)
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

/** What is wrong with a direction's subheadline and footer, besides the
 *  facts it leaves out, in words the model can act on. */
export function copyProblems(
  copy: Pick<FactCopy, "subheadline" | "footerLines"> &
    Partial<Pick<FactCopy, "headline" | "cta">>,
): string[] {
  const problems: string[] = [];
  /* Every fact once, above the footer too (round-7 live critic). */
  for (const repeat of aboveRepeats({
    headline: copy.headline ?? "",
    subheadline: copy.subheadline,
    cta: copy.cta,
  })) {
    problems.push(`${repeat}; give it something the headline does not say`);
  }
  if (copy.subheadline && readsAsList(copy.subheadline)) {
    problems.push(
      "the subheadline reads as a list; make it one or two sentences",
    );
  }
  /* A footer item that says again, by meaning, what the copy above says,
     and that code may not drop because it holds a fact in the brief's
     words: the writer states the fact once (round-7 code critic: the
     deterministic footer-repeat gate read 1 in each run). */
  for (const item of redundantFooterItems({
    headline: copy.headline ?? "",
    subheadline: copy.subheadline,
    cta: copy.cta,
    footerLines: copy.footerLines,
  })) {
    problems.push(
      `the footer item "${item}" says again what the copy above says; state it once`,
    );
  }
  for (const item of headlineFooterRepeats({
    headline: copy.headline ?? "",
    footerLines: copy.footerLines,
  })) {
    problems.push(
      `the footer item "${item}" gives again a value the headline gives; state it once`,
    );
  }
  for (const item of footerItemsOf(copy.footerLines)) {
    if (isFragment(item)) {
      problems.push(`the footer item "${item}" is a fragment; say what it is`);
    }
  }
  for (const line of copy.footerLines) {
    if (timeOnPhoneLine(line)) {
      problems.push(
        `the footer line "${line}" puts a time beside a phone number; give the time its own line`,
      );
    }
  }
  return problems;
}

/** Each field the writer may change that gives a brief date on another
 *  day, in words the model can act on: the field is to be fixed, not the
 *  date stated again beside it (round-15 code critic, finding 6). The
 *  button never changes here, and the headline only when it may
 *  (`headline`); a contradiction there is not the writer's to fix, so it
 *  is neither asked for nor held against a rewrite of the other fields
 *  (round-16 code critic, finding 3). The direction settles it after the
 *  writer: the headline's fails, the button is left off
 *  (withoutContradictedDates). */
export function dateProblems(
  copy: Pick<FactCopy, "headline" | "subheadline" | "footerLines"> &
    Partial<Pick<FactCopy, "cta">>,
  facts: readonly BriefFact[],
  { headline = false }: { headline?: boolean } = {},
): string[] {
  return contradictedDates(facts, copy)
    .filter(
      ({ field }) =>
        field === "subheadline" ||
        field === "footer line" ||
        (headline && field === "headline"),
    )
    .map(
      ({ fact, field, text, run }) =>
        `the ${field} "${text}" gives "${run}" with a weekday or year the brief does not give it; the brief says "${fact}", so rewrite that ${field} to say "${fact}" or to name no other day or year for it`,
    );
}

/** Each field the writer may change that holds a brief fact's words
 *  beside another value of its kind, so states neither: the model sees
 *  the fact's words already there and, untold, writes them again in the
 *  same place (round-17 eval, textile store). */
export function rivalProblems(
  copy: Pick<FactCopy, "headline" | "subheadline" | "footerLines"> &
    Partial<Pick<FactCopy, "cta">>,
  facts: readonly BriefFact[],
  { headline = false }: { headline?: boolean } = {},
): string[] {
  return rivalledFacts(facts, copy)
    .filter(
      ({ field }) =>
        field === "subheadline" ||
        field === "footer line" ||
        (headline && field === "headline"),
    )
    .map(
      ({ fact, field, text, run }) =>
        `the ${field} "${text}" gives "${run}" beside another value of its kind, which reads as a choice and states neither; give "${fact}" a field or footer line of its own`,
    );
}

/** Why a rewrite moved the product's name off the copy above into the
 *  footer, or null: the design then names its product only in small print
 *  (round-17 eval at 0d661d4, bakery: a rewrite taken in part moved
 *  "Strawberry mille-feuille" out of the subheadline onto a footer line of
 *  its own). A product the draft never named above may still be written
 *  into the footer: named there beats not named. */
export function productMovedDown(
  before: FactCopy,
  after: FactCopy,
  facts: readonly BriefFact[],
): string | null {
  const above = (copy: FactCopy) => ({ ...copy, footerLines: [] });
  const moved = facts.find(
    (f) =>
      f.kind === "product" &&
      factStated(f, above(before)) &&
      !factStated(f, above(after)),
  );
  return moved
    ? `it moves "${moved.text}" out of the headline and subheadline; keep the product named above the footer`
    : null;
}

/** What is wrong with a direction's copy that the writer may fix, the
 *  brief's dates and rival values read against every field it may
 *  change. */
function allProblems(
  copy: FactCopy,
  facts: readonly BriefFact[],
  writable: { headline?: boolean } = {},
): string[] {
  return [
    ...copyProblems(copy),
    ...dateProblems(copy, facts, writable),
    ...rivalProblems(copy, facts, writable),
  ];
}

/** The targeted ask for a direction that never names what the brief
 *  offers (round-8 live critic, cafe s1: "Three tasters. ₦6,000." sold an
 *  unnamed drink). The name goes above the footer, where it is read. */
export function offeringFocus(
  offering: BriefFact,
  lastRefusal?: string,
): string[] {
  return [
    `the design never says what it offers: name "${offering.text}", in the brief's words, in the subheadline (or the headline, if it may change), and keep every fact it states`,
    ...(lastRefusal ? [`the last rewrite was refused: ${lastRefusal}`] : []),
  ];
}

/** Why a new headline cannot replace the old, or null when it can: it
 *  may move only out of a fact's way, must clear the repeat it moved for,
 *  keep the old one's idea (one of its words or numbers) and hold to every
 *  rule copy does. The pair kept apart and the claim check are the
 *  caller's. */
export function headlineFault(
  before: FactCopy,
  after: FactCopy,
  facts: readonly BriefFact[],
  ledger: FactLedger,
): string | null {
  const mood = assertsWhatWasAsked(before, after.headline, ledger);
  if (mood) return mood;
  if (!headlineInTheWay(before, facts)) {
    return "the headline may change only when the subheadline would repeat it";
  }
  const fault = copyFault(after.headline, COPY_LIMITS.headline, ledger);
  if (fault) return `headline: ${fault}`;
  const old = contentStems(before.headline);
  if (![...contentStems(after.headline)].some((s) => old.has(s))) {
    return "the new headline drops the headline's idea; keep at least one of its words";
  }
  if (readsAsList(after.headline)) return "the new headline reads as a list";
  return stillInTheWay(after, facts);
}

const HEDGE = /\b(?:could|might|maybe|perhaps)\b/i;

/**
 * A new headline that states what the old one only asked or hedged, in
 * words neither the sources nor the rest of the old copy give. Round-8
 * eval at 33090f8, conference-ko: "Can design beat the heat?" moved to
 * "Design that beats the heat", a claim the brief never makes, and the
 * judge flagged it. The old headline's own words do not license it: the
 * question is what changed.
 */
export function assertsWhatWasAsked(
  before: FactCopy,
  headline: string,
  ledger: FactLedger,
): string | null {
  const old = before.headline.trim();
  const next = headline.trim();
  const asked = old.endsWith("?") && !next.endsWith("?");
  const hedged = HEDGE.test(old) && !HEDGE.test(next);
  if (!asked && !hedged) return null;
  const known = new Set([
    ...contentStems(ledger.text),
    ...contentStems(
      [before.subheadline, before.cta, ...before.footerLines]
        .filter(Boolean)
        .join(" "),
    ),
  ]);
  const beyond = [...contentStems(next)].filter((s) => !known.has(s));
  if (beyond.length === 0) return null;
  return `the new headline asserts what "${old}" only ${
    asked ? "asked" : "hedged"
  }; keep it ${asked ? "a question" : "hedged"}, or say only what the brief says`;
}

/** What of the copy the new headline still stands in the way of, in words
 *  the next ask can act on, or null. */
function stillInTheWay(after: FactCopy, facts: readonly BriefFact[]) {
  if (!headlineInTheWay(after, facts)) return null;
  const blocked = facts.find(
    (f) =>
      !factStated(f, after) &&
      headlineInTheWay({ ...after, subheadline: undefined }, [f]),
  );
  if (blocked) {
    return `"${blocked.text}" is still not stated and saying it below would repeat the new headline; state it whole in the headline, or keep the headline off it`;
  }
  const footerRepeat = headlineFooterRepeats(after)[0];
  return footerRepeat
    ? `the footer item "${footerRepeat}" still gives a value the new headline gives; keep the headline off it, or state it once`
    : "the subheadline still says what the new headline says; leave that out of the subheadline";
}

/** Why a rewrite cannot be drawn, or null when it can. */
export function rewriteFault(
  before: FactCopy,
  after: FactCopy,
  facts: readonly BriefFact[],
  ledger: FactLedger,
): string | null {
  if (after.cta !== before.cta) return "the button changed";
  if (after.headline !== before.headline) {
    const fault = headlineFault(before, after, facts, ledger);
    if (fault) return fault;
  }
  const sub = after.subheadline?.trim() ?? "";
  if (sub) {
    const fault = copyFault(sub, COPY_LIMITS.subheadline, ledger);
    if (fault) return `subheadline: ${fault}`;
  }
  if (after.footerLines.length > MAX_FOOTER_LINES) {
    return `more than ${MAX_FOOTER_LINES} footer lines`;
  }
  for (const line of after.footerLines) {
    const fault = copyFault(line, COPY_LIMITS.footerLine, ledger);
    if (fault) return `footer line "${line}": ${fault}`;
  }
  const movedDown = productMovedDown(before, after, facts);
  if (movedDown) return movedDown;
  const lost = facts.filter(
    (f) => factStated(f, before) && !factStated(f, after),
  );
  if (lost.length > 0) {
    return `it loses ${lost.map((f) => `"${f.text}"`).join(", ")}`;
  }
  /* What a customer acts on in a line the rewrite removed is said
     elsewhere, as for any drop: a reader-missed "Pre-orders close Thursday
     6pm" went with a rewrite that added the facts asked for (round-7 code
     critic, W5). */
  /* Item by item: a rewrite may move a line's date into the subheadline
     and its place onto another line (round-8 eval: whole lines refused). */
  const keptItems = new Set(footerItemsOf(after.footerLines));
  for (const item of footerItemsOf(before.footerLines)) {
    if (keptItems.has(item) || isFragment(item)) continue;
    if (!detailHeldAcross(item, after)) return `it loses "${item}"`;
  }
  /* A list stays a fault whether or not the draft had one: the rewrite
     was its chance to fix it (round-7 code critic, W6). */
  if (
    after.subheadline &&
    after.subheadline !== before.subheadline &&
    readsAsList(after.subheadline)
  ) {
    return "the subheadline reads as a list; make it one or two sentences";
  }
  /* A date still given on another day stays a fault: stating it again
     elsewhere ships two days for one date (round-15 code critic, J30). */
  const headline = after.headline !== before.headline;
  const contradiction = dateProblems(after, facts, { headline })[0];
  if (contradiction) return contradiction;
  /* No new problem, though one the rewrite left alone may stand: a footer
     that now carries the price is worth taking under a subheadline the
     model could not fix. */
  const had = allProblems(before, facts);
  const has = allProblems(after, facts);
  const added = has.filter((p) => !had.includes(p));
  if (added.length > 0) return added[0];
  const gained = facts.filter(
    (f) => !factStated(f, before) && factStated(f, after),
  );
  if (gained.length === 0 && has.length >= had.length) {
    return "it states nothing more";
  }
  return null;
}

/** A fact-writer rewrite that was not taken, whole or in part, with the
 *  model's own text, so a refusal can be audited against what was written
 *  (round-16 code critic, finding 7: pottery's "it loses '6pm to 9pm'"
 *  could not be checked). */
export interface RefusedRewrite {
  direction: number;
  why: string;
  /** What the model wrote; absent when nothing came back. */
  rewrite?: Pick<FactCopy, "headline" | "subheadline" | "footerLines">;
}

const asWritten = (copy: FactCopy): RefusedRewrite["rewrite"] => ({
  headline: copy.headline,
  ...(copy.subheadline ? { subheadline: copy.subheadline } : {}),
  footerLines: copy.footerLines,
});

export interface FactSettlement<T> {
  directions: T[];
  /** Facts the model wrote in that the direction had left out. */
  added: { direction: number; fact: string }[];
  /** Facts still left out, and why. */
  leftOff: { direction: number; fact: string; reason: string }[];
  /** Rewrites refused, whole or in part ("in part: ..."), and why; their
   *  reasons reach factsLeftOff, and all of them
   *  factCoverage.rewritesRefused. */
  refused: RefusedRewrite[];
  /** Headlines the model moved out of a fact's way (headlineInTheWay). */
  headlines: { direction: number; from: string; to: string }[];
  modelCalls: number;
}

/** The rewrite without the footer items that say again what its copy
 *  above says. Code drops, never writes: the model put the fact above and
 *  echoed it below (round-8 eval, retreat: "Reserve at stillwater.ng" under
 *  a button giving it refused a rewrite that added three facts). */
function withoutEchoes<T extends FactCopy>(copy: T): T {
  return redundantFooterItems(copy).reduce(
    (trimmed, item) => withoutItem(trimmed, item),
    copy,
  );
}

/** What of a rewrite to try, most of it first: the whole; the same with
 *  its footer echoes dropped; then the parts the model got right under the
 *  old headline, subheadline or footer. A new headline only ever comes with
 *  the new subheadline it was written for. */
function rewriteParts<T extends FactCopy>(before: T, after: T): T[] {
  const oldFooter = {
    footerLines: before.footerLines,
    footerStyle: before.footerStyle,
  };
  const oldHeadline = { headline: before.headline };
  const oldSubheadline = { subheadline: before.subheadline };
  const parts = [
    after,
    withoutEchoes(after),
    { ...after, ...oldHeadline },
    withoutEchoes({ ...after, ...oldHeadline }),
    { ...after, ...oldHeadline, ...oldSubheadline },
    withoutEchoes({ ...after, ...oldHeadline, ...oldSubheadline }),
    { ...after, ...oldFooter },
    { ...after, ...oldHeadline, ...oldFooter },
  ] as T[];
  const seen = new Set<string>([copyKey(before)]);
  return parts.filter((copy) => {
    const key = copyKey(copy);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function copyKey(copy: FactCopy): string {
  return JSON.stringify([
    copy.headline,
    copy.subheadline ?? "",
    copy.footerLines,
  ]);
}

/** The other designs' words this rewrite borrows. */
function borrowed(copy: FactCopy, avoid: readonly string[]): string[] {
  const own = contentStems(
    [copy.headline, copy.subheadline, copy.cta].filter(Boolean).join(" "),
  );
  return avoid.filter((word) =>
    [...contentStems(word)].some((s) => own.has(s)),
  );
}

function readsLikeTheOther(words: readonly string[]): string {
  return words.length > 0
    ? `it reads like the other design (both say ${words
        .map((w) => `"${w}"`)
        .join(", ")}); keep this design's own idea in its own words`
    : "it reads like the other design; keep this design's own idea";
}

/**
 * Asks the model to state what each direction leaves out and to fix its
 * footer, verifies every answer, and asks once more, with what went wrong,
 * for the directions still short. A rewrite is taken only when it draws,
 * loses no fact, fixes something, keeps the set apart beside every other
 * rewrite taken with it, and passes the claim check; with the claim check
 * down nothing is taken (fail-closed). What is still missing after that is
 * left off and recorded, never patched in by code.
 */
export async function settleFacts<T extends FactCopy>({
  directions,
  facts,
  ledger,
  writer,
  claimCheck,
  briefText,
  title,
  keepsApart = () => true,
  wordsOfOthers = () => [],
  ships = () => true,
  attempts = 2,
  asks = () => true,
  focus = () => [],
}: {
  directions: T[];
  facts: readonly BriefFact[];
  ledger: FactLedger;
  writer: FactWriter;
  /** The claim check on the new fields; null when it could not be read. */
  claimCheck: (
    fields: { id: string; field: string; text: string; limit: number }[],
  ) => Promise<{ id: string; statement?: string }[] | null>;
  briefText: string;
  title: string;
  /** False when the set would read as one design twice. */
  keepsApart?: (directions: T[]) => boolean;
  /** The words the other designs of the set say beyond the brief, which a
   *  rewrite of direction `id` should not borrow. */
  wordsOfOthers?: (directions: T[], id: number) => string[];
  /** False for a direction that will not be delivered (its headline was
   *  lost): no rewrite is asked for it, and its copy is no other's to
   *  keep apart from (round-16 code critic, finding 5). */
  ships?: (id: number) => boolean;
  /** How many times the writer is asked. */
  attempts?: number;
  /** False for a shipping direction this call leaves as it is. */
  asks?: (id: number) => boolean;
  /** What a targeted ask puts first among the problems of direction `id`. */
  focus?: (id: number) => string[];
}): Promise<FactSettlement<T>> {
  const out = [...directions];
  const refused: FactSettlement<T>["refused"] = [];
  const feedback = new Map<number, string>();
  let modelCalls = 0;
  const needing = () =>
    out.flatMap((copy, id) => {
      if (!ships(id) || !asks(id)) return [];
      const missing = facts.filter((f) => !factStated(f, copy));
      const headlineMayChange = headlineInTheWay(copy, facts);
      const problems = allProblems(copy, facts, {
        headline: headlineMayChange,
      });
      if (missing.length === 0 && problems.length === 0) return [];
      const why = feedback.get(id);
      const avoid = wordsOfOthers(out, id);
      const focused = [...focus(id), ...problems];
      return [
        {
          id,
          copy,
          missing: missing.map((f) => f.text),
          keep: facts.filter((f) => factStated(f, copy)).map((f) => f.text),
          problems: why
            ? [...focused, `your last rewrite was refused: ${why}`]
            : focused,
          others: out
            .filter((_, j) => j !== id && ships(j))
            .map((d) => d.subheadline ?? "")
            .filter(Boolean),
          ...(avoid.length > 0 ? { avoid } : {}),
          ...(headlineMayChange ? { headlineMayChange: true } : {}),
        },
      ];
    });
  const setWith = (id: number, copy: T) =>
    out.map((d, j) => (j === id ? copy : d));
  const apartFault = (id: number, copy: T) =>
    keepsApart(setWith(id, copy))
      ? null
      : readsLikeTheOther(borrowed(copy, wordsOfOthers(out, id)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const requests = needing();
    if (requests.length === 0) break;
    modelCalls += 1;
    const written = (await writer({ requests, briefText, title })) ?? [];
    /* `partly`: why the whole rewrite was not taken, when only part was;
       the next ask says so (round-8 eval, pottery: three facts went
       unasked-for after a partial take cleared the reason). */
    const candidates: {
      id: number;
      copy: T;
      partly: string | null;
      written: T;
    }[] = [];
    for (const request of requests) {
      const answer = written.find((w) => w.id === request.id);
      if (!answer) {
        feedback.set(request.id, "no rewrite came back");
        continue;
      }
      const before = out[request.id];
      /* An empty answer keeps the subheadline: the model was asked to
         rewrite it, not to delete it (round-7 code critic, W7). */
      const subheadline =
        answer.subheadline.replace(/\s+/g, " ").trim() ||
        (before.subheadline ?? "");
      const headline =
        (request.headlineMayChange &&
          answer.headline?.replace(/\s+/g, " ").trim()) ||
        before.headline;
      const footerLines = answer.footerLines
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const { subheadline: _old, ...rest } = before;
      const after = {
        ...rest,
        headline,
        ...(subheadline ? { subheadline } : {}),
        footerLines,
        footerStyle:
          footerLines.length === 0
            ? "none"
            : before.footerStyle === "none"
              ? "text"
              : before.footerStyle,
      } as T;
      const faultOf = (copy: T) =>
        rewriteFault(before, copy, facts, ledger) ??
        apartFault(request.id, copy);
      const fault = faultOf(after);
      const taken = rewriteParts(before, after).find(
        (copy) => faultOf(copy) === null,
      );
      if (!taken) {
        const why = fault ?? "it states nothing more";
        feedback.set(request.id, why);
        refused.push({ direction: request.id, why, rewrite: asWritten(after) });
        continue;
      }
      candidates.push({
        id: request.id,
        copy: taken,
        partly: fault,
        written: after,
      });
    }
    if (candidates.length === 0) continue;
    const fields = candidates.flatMap(({ id, copy }) => [
      ...(copy.headline !== out[id].headline
        ? [
            {
              id: `${id}.headline`,
              field: "headline",
              text: copy.headline,
              limit: COPY_LIMITS.headline,
            },
          ]
        : []),
      ...(copy.subheadline && copy.subheadline !== directions[id].subheadline
        ? [
            {
              id: `${id}.subheadline`,
              field: "subheadline",
              text: copy.subheadline,
              limit: COPY_LIMITS.subheadline,
            },
          ]
        : []),
      ...copy.footerLines
        .filter((line) => !directions[id].footerLines.includes(line))
        .map((text, j) => ({
          id: `${id}.footerLines.${j}`,
          field: "footer line",
          text,
          limit: COPY_LIMITS.footerLine,
        })),
    ]);
    modelCalls += fields.length > 0 ? 1 : 0;
    const flagged = fields.length > 0 ? await claimCheck(fields) : [];
    for (const { id, copy, partly, written: whole } of candidates) {
      const claims = (flagged ?? []).filter((f) => f.id.startsWith(`${id}.`));
      /* Each rewrite was held apart from the set as it stood; two taken in
         one round must also hold apart from each other (round-8 eval,
         fitness: both subheadlines came back as "Join our HIIT class ...",
         each fine beside the other's old copy). */
      const why =
        flagged === null
          ? "the claim check could not be read"
          : claims.length > 0
            ? `the claim check found what the brief does not say: ${claims
                .map((c) => `"${c.statement ?? "a claim"}"`)
                .join(", ")}`
            : apartFault(id, copy);
      if (why) {
        feedback.set(id, why);
        refused.push({ direction: id, why, rewrite: asWritten(whole) });
        continue;
      }
      out[id] = copy;
      if (partly) {
        feedback.set(id, partly);
        refused.push({
          direction: id,
          why: `in part: ${partly}`,
          rewrite: asWritten(whole),
        });
      } else feedback.delete(id);
    }
  }
  const added = out.flatMap((copy, direction) =>
    facts
      .filter(
        (f) => !factStated(f, directions[direction]) && factStated(f, copy),
      )
      .map((f) => ({ direction, fact: f.text })),
  );
  const leftOff = out.flatMap((copy, direction) =>
    facts
      .filter((f) => !factStated(f, copy))
      .map((f) => ({
        direction,
        fact: f.text,
        reason: feedback.get(direction)
          ? `the model's rewrite was refused: ${feedback.get(direction)}`
          : "the model did not state it",
      })),
  );
  const headlines = out.flatMap((copy, direction) =>
    copy.headline !== directions[direction].headline
      ? [
          {
            direction,
            from: directions[direction].headline,
            to: copy.headline,
          },
        ]
      : [],
  );
  return { directions: out, added, leftOff, refused, headlines, modelCalls };
}
