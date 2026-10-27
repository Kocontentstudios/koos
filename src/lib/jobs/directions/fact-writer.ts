import { generateObject } from "ai";
import { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import { MAX_FOOTER_LINES } from "@/lib/design/render/footer";
import {
  aboveRepeats,
  type BriefFact,
  detailHeldAcross,
  type FactCopy,
  factStated,
  isFragment,
  redundantFooterItems,
  timeOnPhoneLine,
} from "./brief-facts";
import type { FactLedger } from "./claims";
import { copyFault } from "./finalize";
import { readsAsList } from "./footer-repeats";
import { COPY_LIMITS } from "./schema";

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
 * rules. The headline and the button are never rewritten here: they are
 * the idea and the ask.
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
}

export interface FactWrite {
  id: number;
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
    "You edit the copy of social media designs for a small business. Each design below leaves out something its brief says, or has a footer problem. Rewrite only its subheadline and its footer lines so it states everything listed, naturally, as a person would write it.",
    `The brief: ${briefText}`,
    title ? `Its title: ${title}` : null,
    [
      "Rules:",
      "- Do not change the headline or the button. Return only the subheadline and the footer lines.",
      '- State every fact listed under "must state", in the brief\'s words or with every part of it in one place: a price with its currency, amount and unit together ("₦18,000 per split unit", never "₦18,000" alone); a count with its noun ("two senior React engineers", never "Two"); an offer, condition or requirement word for word as the brief writes it ("Free delivery to Lekki, Ajah and Ikoyi", "You need at least 2 years in a busy kitchen").',
      '- Keep every fact listed under "keep".',
      "- Put a fact in the subheadline when it reads naturally there, else in the footer. The subheadline is at most two sentences and 140 characters; never string clauses together with dashes, semicolons or full stops into a list. What does not fit that goes in the footer.",
      "- Keep each design's own idea: its subheadline must not repeat or reorder another design's.",
      `- The footer is at most ${MAX_FOOTER_LINES} lines of at most 60 characters; items on one line are joined by " · ".`,
      '- Every footer item says what it is ("Call 0803 555 0142", "Open 9am to 4pm"); none is a bare number, time or word.',
      "- Never put a time or opening hours on the same footer line as a phone number.",
      "- No footer item repeats the headline, the subheadline, the button or another footer item, and the subheadline never says again a price, number, name or phrase the headline or button already says: leave that out of it.",
      "- Use only what the brief says. Add no fact, claim or quality of your own.",
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
        ]
          .filter(Boolean)
          .join("\n"),
      )
      .join("\n\n"),
    'Return "rewrites": one entry per design with its id, "subheadline" and "footerLines".',
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

/** Why a rewrite cannot be drawn, or null when it can. */
export function rewriteFault(
  before: FactCopy,
  after: FactCopy,
  facts: readonly BriefFact[],
  ledger: FactLedger,
): string | null {
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
  /* No new problem, though one the rewrite left alone may stand: a footer
     that now carries the price is worth taking under a subheadline the
     model could not fix. */
  const had = copyProblems(before);
  const has = copyProblems(after);
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

export interface FactSettlement<T> {
  directions: T[];
  /** Facts the model wrote in that the direction had left out. */
  added: { direction: number; fact: string }[];
  /** Facts still left out, and why. */
  leftOff: { direction: number; fact: string; reason: string }[];
  /** Rewrites refused, and why; their reasons reach factsLeftOff. */
  refused: { direction: number; why: string }[];
  modelCalls: number;
}

/**
 * Asks the model to state what each direction leaves out and to fix its
 * footer, verifies every answer, and asks once more, with what went wrong,
 * for the directions still short. A rewrite is taken only when it draws,
 * loses no fact, fixes something, and passes the claim check; with the
 * claim check down nothing is taken (fail-closed). What is still missing
 * after that is left off and recorded, never patched in by code.
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
}): Promise<FactSettlement<T>> {
  const out = [...directions];
  const refused: FactSettlement<T>["refused"] = [];
  const feedback = new Map<number, string>();
  let modelCalls = 0;
  const needing = () =>
    out.flatMap((copy, id) => {
      const missing = facts.filter((f) => !factStated(f, copy));
      const problems = copyProblems(copy);
      if (missing.length === 0 && problems.length === 0) return [];
      const why = feedback.get(id);
      return [
        {
          id,
          copy,
          missing: missing.map((f) => f.text),
          keep: facts.filter((f) => factStated(f, copy)).map((f) => f.text),
          problems: why
            ? [...problems, `your last rewrite was refused: ${why}`]
            : problems,
          others: out
            .filter((_, j) => j !== id)
            .map((d) => d.subheadline ?? "")
            .filter(Boolean),
        },
      ];
    });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const requests = needing();
    if (requests.length === 0) break;
    modelCalls += 1;
    const written = (await writer({ requests, briefText, title })) ?? [];
    const candidates: { id: number; copy: T }[] = [];
    for (const request of requests) {
      const answer = written.find((w) => w.id === request.id);
      if (!answer) {
        feedback.set(request.id, "no rewrite came back");
        continue;
      }
      /* An empty answer keeps the subheadline: the model was asked to
         rewrite it, not to delete it (round-7 code critic, W7). */
      const subheadline =
        answer.subheadline.replace(/\s+/g, " ").trim() ||
        (out[request.id].subheadline ?? "");
      const footerLines = answer.footerLines
        .map((l) => l.replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const before = out[request.id];
      const { subheadline: _old, ...rest } = before;
      const after = {
        ...rest,
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
        (keepsApart(out.map((d, j) => (j === request.id ? copy : d)))
          ? null
          : "it reads like the other design; keep this design's own idea");
      /* The whole rewrite first; failing that, its footer under the old
         subheadline, or its subheadline over the old footer: the half the
         model got right is taken, the other half asked for again. */
      const halves = [
        after,
        { ...after, subheadline: before.subheadline } as T,
        {
          ...after,
          footerLines: before.footerLines,
          footerStyle: before.footerStyle,
        } as T,
      ];
      const fault = faultOf(after);
      const taken = halves.find((copy) => faultOf(copy) === null);
      if (!taken) {
        const why = fault ?? "it states nothing more";
        feedback.set(request.id, why);
        refused.push({ direction: request.id, why });
        continue;
      }
      if (fault) feedback.set(request.id, fault);
      candidates.push({ id: request.id, copy: taken });
    }
    if (candidates.length === 0) continue;
    const fields = candidates.flatMap(({ id, copy }) => [
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
    for (const { id, copy } of candidates) {
      const claims = (flagged ?? []).filter((f) => f.id.startsWith(`${id}.`));
      const why =
        flagged === null
          ? "the claim check could not be read"
          : claims.length > 0
            ? `the claim check found what the brief does not say: ${claims
                .map((c) => `"${c.statement ?? "a claim"}"`)
                .join(", ")}`
            : null;
      if (why) {
        feedback.set(id, why);
        refused.push({ direction: id, why });
        continue;
      }
      out[id] = copy;
      feedback.delete(id);
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
  return { directions: out, added, leftOff, refused, modelCalls };
}
