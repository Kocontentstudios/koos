import {
  type ApprovedOutline,
  FRAME_BOUNDS,
  type FrameRole,
  OUTLINE_LIMITS,
  type OutlinePoint,
  type OutlineSource,
  type PlannedOutline,
  type SequenceKind,
} from "@/lib/design/sequence/contract";

/**
 * The outline the user is editing, before it is approved. Pure: every edit
 * returns a new draft, so the rules (hook first, action last, N within
 * FRAME_BOUNDS) hold by construction rather than by the UI remembering them.
 */
export interface OutlineDraft {
  kind: SequenceKind;
  points: OutlinePoint[];
  /** Every hard brief fact, in the brief's words (PlannedOutline.facts). */
  facts: string[];
  offering: string | null;
  /** True once the user changed anything the planner gave. */
  edited: boolean;
  /** Feeds the id of the next point the user adds. */
  nextId: number;
}

export type OutlineField = "title" | "point";

export const FIELD_LIMITS: Record<OutlineField, number> = {
  title: OUTLINE_LIMITS.titleChars,
  point: OUTLINE_LIMITS.pointChars,
};

function roleAt(index: number, count: number): FrameRole {
  if (index === 0) return "hook";
  return index === count - 1 ? "cta" : "body";
}

function withRoles(points: OutlinePoint[]): OutlinePoint[] {
  return points.map((point, index) => {
    const role = roleAt(index, points.length);
    return point.role === role ? point : { ...point, role };
  });
}

export function draftFrom(planned: PlannedOutline): OutlineDraft {
  return {
    kind: planned.kind,
    points: withRoles(planned.points),
    facts: planned.facts,
    offering: planned.offering,
    edited: false,
    nextId: 1,
  };
}

const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Whether the user's own words still carry a brief fact. Loose on purpose:
 *  it only decides which facts the UI warns are no longer stated. */
export function statesFact(text: string, fact: string): boolean {
  const needle = normalised(fact);
  return needle.length > 0 && normalised(text).includes(needle);
}

function factsIn(draft: OutlineDraft, title: string, point: string): string[] {
  return draft.facts.filter((fact) => statesFact(`${title} ${point}`, fact));
}

/* A textarea lets the user type a newline, and a control character is
   refused by the server (OUTLINE.md, "markup"), so line breaks become
   spaces as they are typed. */
function plainLine(value: string, field: OutlineField): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, FIELD_LIMITS[field]);
}

export function editPoint(
  draft: OutlineDraft,
  id: string,
  field: OutlineField,
  value: string,
): OutlineDraft {
  const text = plainLine(value, field);
  let changed = false;
  const points = draft.points.map((point) => {
    if (point.id !== id || point[field] === text) return point;
    changed = true;
    /* The point is the claim; the title only names it. So a retitle keeps
       who the claim came from and any flag on it, and only new words in the
       point make it the user's (OUTLINE.md: profile-fill never sits on a
       "user" point). */
    if (field === "title") return { ...point, title: text };
    return {
      ...point,
      point: text,
      source: "user" as OutlineSource,
      weak: null,
      facts: factsIn(draft, point.title, text),
    };
  });
  return changed ? { ...draft, points, edited: true } : draft;
}

export function canAdd(draft: OutlineDraft): boolean {
  return draft.points.length < FRAME_BOUNDS[draft.kind].max;
}

export function canRemove(draft: OutlineDraft, id: string): boolean {
  const point = draft.points.find((p) => p.id === id);
  return (
    point?.role === "body" && draft.points.length > FRAME_BOUNDS[draft.kind].min
  );
}

function freshId(draft: OutlineDraft): { id: string; nextId: number } {
  const taken = new Set(draft.points.map((p) => p.id));
  let n = draft.nextId;
  while (taken.has(`u-${n}`)) n += 1;
  return { id: `u-${n}`, nextId: n + 1 };
}

/** A blank body point just before the action, which stays last. */
export function addPoint(draft: OutlineDraft): {
  draft: OutlineDraft;
  id: string | null;
} {
  if (!canAdd(draft)) return { draft, id: null };
  const { id, nextId } = freshId(draft);
  const added: OutlinePoint = {
    id,
    role: "body",
    title: "",
    point: "",
    source: "user",
    facts: [],
    weak: null,
  };
  const points = [...draft.points];
  points.splice(points.length - 1, 0, added);
  return {
    draft: { ...draft, points: withRoles(points), edited: true, nextId },
    id,
  };
}

export type MoveDirection = "up" | "down";

/** The hook opens and the action closes, so only a body point moves, and
 *  only to another body point's place. */
export function canMove(
  draft: OutlineDraft,
  id: string,
  direction: MoveDirection,
): boolean {
  const index = draft.points.findIndex((p) => p.id === id);
  if (index < 0 || draft.points[index].role !== "body") return false;
  const target = direction === "up" ? index - 1 : index + 1;
  return draft.points[target]?.role === "body";
}

export function movePoint(
  draft: OutlineDraft,
  id: string,
  direction: MoveDirection,
): OutlineDraft {
  if (!canMove(draft, id, direction)) return draft;
  const index = draft.points.findIndex((p) => p.id === id);
  const target = direction === "up" ? index - 1 : index + 1;
  const points = [...draft.points];
  [points[index], points[target]] = [points[target], points[index]];
  return { ...draft, points, edited: true };
}

export function removePoint(draft: OutlineDraft, id: string): OutlineDraft {
  if (!canRemove(draft, id)) return draft;
  const points = draft.points
    .filter((p) => p.id !== id)
    .map((p) =>
      p.weak?.kind === "overlap" && p.weak.overlapsWith === id
        ? { ...p, weak: null }
        : p,
    );
  return { ...draft, points: withRoles(points), edited: true };
}

/**
 * The reason to show under a weak point. The server writes an overlap's
 * reason with the slide number it had when planned; after an add or a delete
 * that number is wrong, so it is said again from where the earlier point
 * sits now.
 */
export function weakReason(
  draft: OutlineDraft,
  point: OutlinePoint,
): string | null {
  const { weak } = point;
  if (!weak) return null;
  if (weak.kind !== "overlap") return weak.reason;
  const index = draft.points.findIndex((p) => p.id === weak.overlapsWith);
  if (index < 0) return weak.reason;
  const earlier = draft.points[index];
  const title = earlier.title.trim();
  return `Says the same as slide ${index + 1}${title ? `, “${title}”` : ""}. Give this slide a different point.`;
}

export function weakCount(draft: OutlineDraft): number {
  return draft.points.filter((p) => p.weak).length;
}

/** The brief's facts no point states any more, after the user deleted or
 *  rewrote the points that did. */
export function unstatedFacts(draft: OutlineDraft): string[] {
  const stated = new Set(draft.points.flatMap((p) => p.facts));
  return draft.facts.filter((fact) => !stated.has(fact));
}

/* The same characters validateApprovedOutline refuses: the words are drawn
   on a frame and sent to the copy model, so neither may get markup. */
function hasMarkup(text: string): boolean {
  if (/[<>`]|\{\{|\}\}/.test(text)) return true;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const EMPTY_MESSAGE: Record<OutlineField, string> = {
  title: "Give this slide a title.",
  point: "Say what this slide tells the reader, or delete it.",
};

export function fieldProblem(
  field: OutlineField,
  value: string,
): string | null {
  const text = value.trim();
  if (!text) return EMPTY_MESSAGE[field];
  if (text.length > FIELD_LIMITS[field]) {
    return `Keep this to ${FIELD_LIMITS[field]} characters.`;
  }
  if (hasMarkup(text)) {
    return "Take out < > ` {{ and }}. A slide shows plain words.";
  }
  return null;
}

export interface DraftProblem {
  id: string;
  field: OutlineField;
  message: string;
}

export function draftProblems(draft: OutlineDraft): DraftProblem[] {
  return draft.points.flatMap((point) =>
    (["title", "point"] as const).flatMap((field) => {
      const message = fieldProblem(field, point[field]);
      return message ? [{ id: point.id, field, message }] : [];
    }),
  );
}

export function toApproved(draft: OutlineDraft): ApprovedOutline {
  return {
    kind: draft.kind,
    points: draft.points.map(({ id, role, title, point, source }) => ({
      id,
      role,
      title: title.trim(),
      point: point.trim(),
      source,
    })),
  };
}

const SOURCE_LABELS: Record<OutlineSource, string> = {
  brief: "From your brief",
  profile: "From your brand profile",
  user: "Written by you",
};

export function sourceLabel(source: OutlineSource): string {
  return SOURCE_LABELS[source];
}

/** One quota unit per frame, so the button says both. */
export function generateLabel(count: number): string {
  const slides = count === 1 ? "1 slide" : `${count} slides`;
  const units = count === 1 ? "1 unit" : `${count} units`;
  return `Generate ${slides} · ${units}`;
}

export function countOptions(kind: SequenceKind): number[] {
  const { min, max } = FRAME_BOUNDS[kind];
  return Array.from({ length: max - min + 1 }, (_, i) => min + i);
}
