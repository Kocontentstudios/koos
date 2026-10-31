import { z } from "zod";
import { contentStems } from "@/lib/jobs/directions/text-overlap";
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

/* Generous caps so a hostile body fails on its own rules, not on a
   parser limit, while a megabyte of text is still refused as shape. */
const RAW_TEXT_MAX = 2000;
const RAW_POINTS_MAX = 50;

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
      }),
    )
    .max(RAW_POINTS_MAX),
});

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/* Share of a point's content words its source must hold for the point to
   be the source's: the planner's own points restate a clause or join two,
   so they keep most words but not every one. */
const SOURCE_SHARE = 0.8;

function heldBy(point: string, source: string): boolean {
  if (!source.trim()) return false;
  if (flat(source).toLowerCase().includes(flat(point).toLowerCase())) {
    return true;
  }
  const stems = [...contentStems(point)];
  if (stems.length === 0) return false;
  const theirs = contentStems(source);
  return (
    stems.filter((s) => theirs.has(s)).length / stems.length >= SOURCE_SHARE
  );
}

/** Where a point's words come from, recomputed on the server: the brief,
 *  else the profile, else the owner, whose words then count as stated. */
export function outlineSourceOf(
  point: string,
  ctx: Pick<OutlineValidateContext, "briefText" | "profileStatements">,
): OutlineSource {
  if (heldBy(point, ctx.briefText)) return "brief";
  if (heldBy(point, ctx.profileStatements.join("\n"))) return "profile";
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
  if (MARKUP.test(raw)) {
    return [
      {
        point: i,
        rule: "markup",
        detail: `the ${field} holds markup or a control character`,
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
 * Every source is recomputed: a point whose words the brief holds is
 * "brief", the profile's "profile", anything else "user", which copy treats
 * as stated. Pure.
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
          source: outlineSourceOf(point, ctx),
        };
      }),
    },
  };
}
