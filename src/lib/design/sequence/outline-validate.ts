import { z } from "zod";
import {
  type ApprovedOutline,
  type ApprovedOutlinePoint,
  FRAME_BOUNDS,
  FRAME_ROLES,
  OUTLINE_LIMITS,
  OUTLINE_SOURCES,
  type OutlineProblem,
  type OutlineSource,
  SEQUENCE_KINDS,
  type SequenceKind,
} from "./contract";
import { signedSource } from "./outline-sign";

export interface OutlineValidateContext {
  /** The kind the server resolved from the brief; the client's is checked
   *  against it, never trusted. */
  kind: SequenceKind;
  briefText: string;
  /** The profile's statements (profileStatements), in their own words. */
  profileStatements: readonly string[];
}

export type OutlineValidation =
  | { ok: true; outline: ApprovedOutline }
  | { ok: false; problems: OutlineProblem[] };

const ID = /^[a-z0-9-]{1,40}$/;

/* The words are drawn on a frame and sent to the copy model: an angle
   bracket or a template brace could reach either as markup, a backtick as
   a code span, a control character as a broken line. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this refuses
const MARKUP = /[<>`]|\{\{|\}\}|[\u0000-\u0008\u000b-\u001f\u007f]/;

/* Direction-override and isolate marks reorder what a reader sees
   against what the server reads, so "11pm" can display as "mp11". */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

/* Invisible characters that split a word without changing how it looks
   ("ig\u200bnore"). The zero-width joiner stays: emoji sequences use it. */
const INVISIBLE = /[\u00ad\u200b\u200c\u2060-\u2064\ufeff]/g;

/* Cyrillic and Greek letters drawn like Latin ones. A word that mixes them
   with Latin letters is spelled to look like one word and read as
   another: "Іgnore" with a Cyrillic І passes a check for "ignore". */
const LOOKALIKE: Record<string, string> = {
  а: "a",
  в: "b",
  е: "e",
  к: "k",
  м: "m",
  н: "h",
  о: "o",
  р: "p",
  с: "c",
  т: "t",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  ԁ: "d",
  ӏ: "l",
  ɡ: "g",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ν: "v",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};
const LOOKALIKES = new RegExp(`[${Object.keys(LOOKALIKE).join("")}]`, "giu");
const MIXED_SCRIPT =
  /(?=[\p{L}]*\p{Script=Latin})(?=[\p{L}]*[\p{Script=Cyrillic}\p{Script=Greek}])[\p{L}]+/u;

const unmasked = (text: string) =>
  text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(LOOKALIKES, (ch) => LOOKALIKE[ch.toLowerCase()] ?? ch);

/* Words addressed to the model rather than the reader: an outline point
   is copy a frame states, so a sentence telling the writer what to do is
   refused, not drawn (O4). Narrow on purpose: "Ignore the queue, book
   online" and "Forget everything you know about laundry" are copy;
   "ignore all earlier instructions" and "disregard what you were told"
   are not. */
const INSTRUCTION = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.!?]{0,40}\b(?:instructions?|prompts?|rules|guidelines|directions|system)\b/i,
  /\b(?:ignore|disregard|forget)\b[^.!?]{0,40}\b(?:you\s+(?:were|have\s+been|was)\s+(?:told|given|asked|shown)|(?:said|written|given)\s+(?:above|before|earlier)|(?:earlier|previous|prior|above)\s+(?:text|messages?|context|content|points?))\b/i,
  /\b(?:system|developer)\s+(?:prompt|message|instructions?)\b/i,
  /\byou\s+are\s+now\b|\bact\s+as\s+(?:an?|the)\s+(?:ai|assistant|model|language)\b/i,
  /\b(?:new|updated|real)\s+instructions?\b/i,
  /\b(?:write|put|add|print|say)\b[^.!?]{0,60}\bon\s+(?:every|each|all)\s+(?:slides?|frames?)\b/i,
  /(?:^|[.!?]\s*)(?:assistant|system|developer|user|human|ai|model)\s*:/i,
];

/* Generous caps so a hostile body fails on its own rules, not on a
   parser limit, while a megabyte of text is still refused as shape. */
const RAW_TEXT_MAX = 2000;
const RAW_POINTS_MAX = 50;
const RAW_SIG_MAX = 200;

const outlineSchema = z.object({
  kind: z.enum(SEQUENCE_KINDS),
  points: z
    .array(
      z.object({
        id: z.string().max(RAW_TEXT_MAX),
        role: z.enum(FRAME_ROLES),
        title: z.string().max(RAW_TEXT_MAX),
        point: z.string().max(RAW_TEXT_MAX),
        source: z.enum(OUTLINE_SOURCES),
        sig: z.string().max(RAW_SIG_MAX).optional(),
      }),
    )
    .max(RAW_POINTS_MAX),
});

const flat = (text: string) =>
  text.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

const plain = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/* Only words the source gives as they are: a point the owner edited keeps
   most of the brief's words, and a share test read "open 5am to 11pm"
   over the brief's "5am to 10pm" as the brief's, so the owner's corrected
   hours were written back to the brief's. */
function heldBy(point: string, source: string): boolean {
  const words = plain(point);
  return words.length > 0 && ` ${plain(source)} `.includes(` ${words} `);
}

/** Where an unsigned point's words come from, recomputed on the server:
 *  the brief when it gives them word for word, else the profile, else the
 *  owner, whose words then count as stated. */
export function outlineSourceOf(
  point: string,
  ctx: Pick<OutlineValidateContext, "briefText" | "profileStatements">,
): OutlineSource {
  if (heldBy(point, ctx.briefText)) return "brief";
  if (ctx.profileStatements.some((s) => heldBy(point, s))) return "profile";
  return "user";
}

function roleProblem(
  role: ApprovedOutlinePoint["role"],
  i: number,
  last: number,
): OutlineProblem | null {
  if (i === 0 && role !== "hook") {
    return {
      point: i,
      rule: "hook-first",
      detail: "the first point is the hook",
    };
  }
  if (i > 0 && role === "hook") {
    return {
      point: i,
      rule: "hook-first",
      detail: "only the first point is the hook",
    };
  }
  if (i === last && role !== "cta") {
    return {
      point: i,
      rule: "cta-last",
      detail: "the last point is the action",
    };
  }
  if (i < last && role === "cta") {
    return {
      point: i,
      rule: "cta-only-last",
      detail: "only the last point is the action",
    };
  }
  return null;
}

function textProblems(
  field: "title" | "point",
  raw: string,
  i: number,
): OutlineProblem[] {
  /* NFKC folds fullwidth and small-form brackets ("＜script＞", "﹤") to
     the ASCII ones the check refuses. */
  const folded = raw.normalize("NFKC");
  if (MARKUP.test(folded) || BIDI.test(folded)) {
    return [
      {
        point: i,
        rule: "markup",
        detail: `the ${field} holds markup or a control character`,
      },
    ];
  }
  if (MIXED_SCRIPT.test(folded.replace(INVISIBLE, ""))) {
    return [
      {
        point: i,
        rule: "injection",
        detail: `the ${field} spells a word in two alphabets; type it again in one`,
      },
    ];
  }
  if (INSTRUCTION.some((pattern) => pattern.test(unmasked(raw)))) {
    return [
      {
        point: i,
        rule: "injection",
        detail: `the ${field} is written to the writer, not the reader; say what the slide tells the reader`,
      },
    ];
  }
  const text = flat(raw);
  if (!text) {
    return [{ point: i, rule: "empty", detail: `the ${field} is empty` }];
  }
  const max =
    field === "title" ? OUTLINE_LIMITS.titleChars : OUTLINE_LIMITS.pointChars;
  return text.length > max
    ? [
        {
          point: i,
          rule: "too-long",
          detail: `the ${field} is ${text.length} characters; at most ${max}`,
        },
      ]
    : [];
}

/**
 * The client's approved outline, parsed with zod and held to the contract:
 * count within FRAME_BOUNDS, hook first, cta last and only last, ids
 * unique and well formed, title and point non-empty and within
 * OUTLINE_LIMITS, no markup. Text is trimmed and its whitespace collapsed.
 * Every source is recomputed, never read from the client: a point whose
 * signature still matches its words keeps the source it was planned with
 * (the planner's own wording is never the owner's); any other point is
 * "brief" when the brief gives its words as they are, "profile" when a
 * profile statement does, else "user", which copy treats as stated: an
 * edit of one figure makes the point the owner's.
 */
export function validateApprovedOutline(
  raw: unknown,
  ctx: OutlineValidateContext,
): OutlineValidation {
  const parsed = outlineSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      problems: [
        {
          point: null,
          rule: "shape",
          detail:
            "not an outline: { kind, points: { id, role, title, point, source }[] }",
        },
      ],
    };
  }
  const { kind, points } = parsed.data;
  const problems: OutlineProblem[] = [];
  if (kind !== ctx.kind) {
    problems.push({
      point: null,
      rule: "kind",
      detail: `the brief is a ${ctx.kind}, not a ${kind}`,
    });
  }
  const { min, max } = FRAME_BOUNDS[ctx.kind];
  if (points.length < min || points.length > max) {
    problems.push({
      point: null,
      rule: "count",
      detail: `a ${ctx.kind} has ${min} to ${max} points, not ${points.length}`,
    });
  }
  const last = points.length - 1;
  const seen = new Set<string>();
  points.forEach((p, i) => {
    const role = roleProblem(p.role, i, last);
    if (role) problems.push(role);
    if (!ID.test(p.id)) {
      problems.push({
        point: i,
        rule: "id",
        detail: "an id is 1 to 40 lowercase letters, digits or hyphens",
      });
    } else if (seen.has(p.id)) {
      problems.push({
        point: i,
        rule: "id-repeat",
        detail: `the id "${p.id}" is used twice`,
      });
    }
    seen.add(p.id);
    problems.push(
      ...textProblems("title", p.title, i),
      ...textProblems("point", p.point, i),
    );
  });
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    outline: {
      kind,
      points: points.map((p) => {
        const point = flat(p.point);
        return {
          id: p.id,
          role: p.role,
          title: flat(p.title),
          point,
          source:
            signedSource(
              {
                kind: ctx.kind,
                briefText: ctx.briefText,
                role: p.role,
                point,
              },
              p.sig,
            ) ?? outlineSourceOf(point, ctx),
        };
      }),
    },
  };
}
