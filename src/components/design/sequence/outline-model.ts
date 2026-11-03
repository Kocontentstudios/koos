import {
  type ApprovedOutline,
  FRAME_BOUNDS,
  type FrameRole,
  OUTLINE_LIMITS,
  type OutlinePoint,
  type OutlineSource,
  type OutlineWeak,
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
  /** True while the points differ from what the planner gave, so typing a
   *  letter and deleting it, or a delete then Undo, leaves it false. */
  edited: boolean;
  /** Feeds the id of the next point the user adds. */
  nextId: number;
  /** Each planner point as it arrived, by id. Source, facts and flags are
   *  worked out against it on every change, so undoing an edit (or a
   *  delete) brings them back rather than leaving them lost. */
  planned: Record<string, OutlinePoint>;
  /** The planner's point ids in its order. */
  plannedOrder: string[];
  /** Deleted points, newest last, for undo. */
  removed: RemovedPoint[];
}

export interface RemovedPoint {
  point: OutlinePoint;
  /** Where it sat when it was deleted. */
  index: number;
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
  const points = withRoles(planned.points);
  return {
    kind: planned.kind,
    points,
    facts: planned.facts,
    offering: planned.offering,
    edited: false,
    nextId: 1,
    planned: Object.fromEntries(points.map((p) => [p.id, p])),
    plannedOrder: points.map((p) => p.id),
    removed: [],
  };
}

function differsFromPlan(draft: OutlineDraft, points: OutlinePoint[]): boolean {
  if (points.length !== draft.plannedOrder.length) return true;
  return points.some((point, index) => {
    const planned = draft.planned[point.id];
    return (
      draft.plannedOrder[index] !== point.id ||
      planned === undefined ||
      planned.title !== point.title ||
      planned.point !== point.point
    );
  });
}

function withPoints(draft: OutlineDraft, points: OutlinePoint[]): OutlineDraft {
  return { ...draft, points, edited: differsFromPlan(draft, points) };
}

const normalised = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** Same words in the same order: a full stop, a capital or a double space
 *  does not change what the slide claims. */
export function sameClaim(a: string, b: string): boolean {
  return normalised(a) === normalised(b);
}

/** Whether the user's own words still carry a brief fact. Loose on purpose:
 *  it only decides which facts the UI warns are no longer stated. */
export function statesFact(text: string, fact: string): boolean {
  const needle = normalised(fact);
  return needle.length > 0 && normalised(text).includes(needle);
}

/* A textarea lets the user type a newline, and a control character is
   refused by the server (OUTLINE.md, "markup"), so line breaks become
   spaces as they are typed. */
function plainLine(value: string, field: OutlineField): string {
  return value.replace(/[\r\n\t]+/g, " ").slice(0, FIELD_LIMITS[field]);
}

/* Two letters or fewer is grammar ("in", "is", "of"), never the claim. */
function claimWords(text: string): string[] {
  return normalised(text)
    .split(" ")
    .filter((word) => word.length > 2);
}

/** Whether `point` still makes `earlier`'s point: it states a brief fact the
 *  earlier one states, or it holds every word of the earlier claim. The
 *  server's overlap test (claimsOverlap) is fact-based; this keeps the flag
 *  while that basis is still on screen. */
function stillRepeats(point: OutlinePoint, earlier: OutlinePoint): boolean {
  if (point.facts.some((fact) => earlier.facts.includes(fact))) return true;
  const words = new Set(claimWords(point.point));
  const earlierWords = claimWords(earlier.point);
  return earlierWords.length > 0 && earlierWords.every((w) => words.has(w));
}

/* A fact the planner tied to a point stays tied while its words are on the
   slide. One it found only in the old title goes once that title does; one
   it read into the point's paraphrase stays while the claim is unchanged. */
function factsFor(
  draft: OutlineDraft,
  point: OutlinePoint,
  planned: OutlinePoint | undefined,
): string[] {
  if (planned?.title === point.title && planned.point === point.point) {
    return planned.facts;
  }
  const shown = `${point.title} ${point.point}`;
  const literal = draft.facts.filter((fact) => statesFact(shown, fact));
  if (!planned || !sameClaim(planned.point, point.point)) return literal;
  const kept = planned.facts.filter(
    (fact) => statesFact(shown, fact) || !statesFact(planned.title, fact),
  );
  return [...kept, ...literal.filter((fact) => !kept.includes(fact))];
}

/** Who a point's claim belongs to and which brief facts it states, against
 *  the planner's version. The title only names the claim, so it never moves
 *  the source (OUTLINE.md: profile-fill never sits on a "user" point). */
function settlePoint(draft: OutlineDraft, point: OutlinePoint): OutlinePoint {
  const planned = draft.planned[point.id];
  const source =
    planned && sameClaim(planned.point, point.point) ? planned.source : "user";
  return { ...point, source, facts: factsFor(draft, point, planned) };
}

function settleFlag(
  draft: OutlineDraft,
  points: OutlinePoint[],
  point: OutlinePoint,
): OutlineWeak | null {
  const planned = draft.planned[point.id];
  const weak = planned?.weak ?? null;
  if (!weak) return null;
  if (weak.kind !== "overlap") {
    return sameClaim(planned.point, point.point) ? weak : null;
  }
  const earlier = points.find((p) => p.id === weak.overlapsWith);
  if (!earlier) return null;
  const untouched =
    sameClaim(planned.point, point.point) &&
    sameClaim(draft.planned[earlier.id]?.point ?? "", earlier.point);
  return untouched || stillRepeats(point, earlier) ? weak : null;
}

/** Sources and facts first, since an overlap is judged on facts. */
function settle(draft: OutlineDraft, points: OutlinePoint[]): OutlinePoint[] {
  const settled = points.map((point) => settlePoint(draft, point));
  return settled.map((point) => {
    const weak = settleFlag(draft, settled, point);
    return point.weak === weak ? point : { ...point, weak };
  });
}

export function editPoint(
  draft: OutlineDraft,
  id: string,
  field: OutlineField,
  value: string,
): OutlineDraft {
  const text = plainLine(value, field);
  const target = draft.points.find((point) => point.id === id);
  if (!target || target[field] === text) return draft;
  const points = draft.points.map((point) =>
    point.id === id ? { ...point, [field]: text } : point,
  );
  return withPoints(draft, settle(draft, points));
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
    draft: { ...withPoints(draft, withRoles(points)), nextId },
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
  return withPoints(draft, points);
}

export function removePoint(draft: OutlineDraft, id: string): OutlineDraft {
  if (!canRemove(draft, id)) return draft;
  const index = draft.points.findIndex((p) => p.id === id);
  const points = draft.points.filter((p) => p.id !== id);
  return {
    ...withPoints(draft, settle(draft, withRoles(points))),
    removed: [...draft.removed, { point: draft.points[index], index }],
  };
}

export function lastRemoved(draft: OutlineDraft): RemovedPoint | null {
  return draft.removed.at(-1) ?? null;
}

/** Undo needs room: a restore past the kind's maximum would be refused. */
export function canRestore(draft: OutlineDraft): boolean {
  return draft.removed.length > 0 && canAdd(draft);
}

/** Puts the newest deleted point back where it was, or as near as the hook
 *  and the action allow after other edits. */
export function restoreRemoved(draft: OutlineDraft): {
  draft: OutlineDraft;
  index: number | null;
} {
  const last = lastRemoved(draft);
  if (!last || !canRestore(draft)) return { draft, index: null };
  const removed = draft.removed.slice(0, -1);
  if (draft.points.some((p) => p.id === last.point.id)) {
    return { draft: { ...draft, removed }, index: null };
  }
  const index = Math.min(Math.max(last.index, 1), draft.points.length - 1);
  const points = [...draft.points];
  points.splice(index, 0, last.point);
  return {
    draft: {
      ...withPoints(draft, settle(draft, withRoles(points))),
      removed,
    },
    index,
  };
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
    points: draft.points.map(({ id, role, title, point, source, sig }) => ({
      id,
      role,
      title: title.trim(),
      point: point.trim(),
      source,
      ...(sig ? { sig } : {}),
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
