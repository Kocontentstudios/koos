import {
  type FrameRole,
  type LeftOutFrame,
  type SequenceJobResult,
  type SequenceKind,
  sequenceKindOf,
} from "@/lib/design/sequence/contract";
import type { SerializedGeneration } from "@/lib/design/serialize";

/** One place in a set. The row is whichever is on show at this index, of any
 *  status; null where the job wrote no row at all. */
export interface FrameSlot {
  index: number;
  role: FrameRole;
  title: string;
  generation: SerializedGeneration | null;
  /** The row is still pending but nothing is building it any more (its job
   *  ended, or it is far older than any set takes): shown as failed, with a
   *  retry, rather than as rendering forever. */
  stalled?: boolean;
}

/** A carousel or presentation as the client holds it: every index from 0 to
 *  frameCount - 1, in order, whether or not it rendered. */
export interface DesignSet {
  setId: string;
  brandId: string;
  kind: SequenceKind;
  frames: FrameSlot[];
  /** Frames the set was asked for and does not deliver, from the job's
   *  result; absent where the set was read from its rows alone. */
  leftOut?: LeftOutFrame[];
}

export type FrameState = "ready" | "rendering" | "failed" | "missing";

export function frameState(slot: FrameSlot): FrameState {
  const status = slot.generation?.status;
  if (!status) return "missing";
  if (status === "succeeded") return "ready";
  return status === "failed" || slot.stalled ? "failed" : "rendering";
}

/** Whether any frame of the set is still on its way. */
export function isBuilding(set: DesignSet): boolean {
  return set.frames.some((slot) => frameState(slot) === "rendering");
}

/** The ids of the rows still on their way, to read again. */
export function renderingIds(set: DesignSet): string[] {
  return set.frames.flatMap((slot) =>
    frameState(slot) === "rendering" && slot.generation
      ? [slot.generation.id]
      : [],
  );
}

/** The set with every frame still on its way shown as stopped. */
export function markStalled(set: DesignSet): DesignSet {
  if (!isBuilding(set)) return set;
  return {
    ...set,
    frames: set.frames.map((slot) =>
      frameState(slot) === "rendering" ? { ...slot, stalled: true } : slot,
    ),
  };
}

const ROLE_LABELS: Record<SequenceKind, Record<FrameRole, string>> = {
  carousel: { hook: "Hook", body: "Point", cta: "Action" },
  presentation: { hook: "Title", body: "Slide", cta: "Close" },
};

export function roleLabel(kind: SequenceKind, role: FrameRole): string {
  return ROLE_LABELS[kind][role];
}

export function kindNoun(kind: SequenceKind): string {
  return kind === "carousel" ? "carousel" : "presentation";
}

export function slideCount(count: number): string {
  return count === 1 ? "1 slide" : `${count} slides`;
}

/* The frame rules (H3): the first frame hooks, the last one acts. An index
   the job wrote no row for still has a known role. */
function expectedRole(index: number, count: number): FrameRole {
  if (index === 0) return "hook";
  return index === count - 1 ? "cta" : "body";
}

const FALLBACK_SIZE: Record<SequenceKind, { width: number; height: number }> = {
  carousel: { width: 1080, height: 1350 },
  presentation: { width: 1920, height: 1080 },
};

/** The box every frame of the set is drawn in: the frames share one size,
 *  so the first that reports one speaks for all. */
export function frameSize(set: DesignSet): { width: number; height: number } {
  for (const { generation } of set.frames) {
    if (generation?.width && generation.height) {
      return { width: generation.width, height: generation.height };
    }
  }
  return FALLBACK_SIZE[set.kind];
}

function kindFromRows(rows: SerializedGeneration[]): SequenceKind {
  for (const row of rows) {
    const kind = sequenceKindOf(row.designType);
    if (kind) return kind;
  }
  /* A designType the format map does not know: a landscape frame is a
     slide, anything else is a post. */
  const sized = rows.find((r) => r.width && r.height);
  return sized?.width && sized.height && sized.width > sized.height
    ? "presentation"
    : "carousel";
}

/* The row on show at an index when the server's supersededBy is not on the
   wire: a replacement only supersedes once it succeeds, so the newest
   succeeded row is the live one, and a failed or pending row shows only
   where nothing ever succeeded. */
function outranks(row: SerializedGeneration, held: SerializedGeneration) {
  const rowOk = row.status === "succeeded";
  const heldOk = held.status === "succeeded";
  if (rowOk !== heldOk) return rowOk;
  return row.createdAt > held.createdAt;
}

/**
 * Gathers the rows of one set into its frames. `kind` and `frameCount` come
 * from the job result when there is one; read back from the rows otherwise.
 */
export function buildSet(
  brandId: string,
  rows: SerializedGeneration[],
  known: {
    setId?: string;
    kind?: SequenceKind;
    frameCount?: number;
    leftOut?: LeftOutFrame[];
  } = {},
): DesignSet | null {
  const framed = rows.filter((r) => r.frame);
  const setId = known.setId ?? framed[0]?.frame?.setId;
  if (!setId) return null;
  const members = framed.filter((r) => r.frame?.setId === setId);
  const kind = known.kind ?? kindFromRows(members);
  const count =
    known.frameCount ?? Math.max(0, ...members.map((r) => r.frame?.count ?? 0));
  if (count === 0) return null;

  const live = new Map<number, SerializedGeneration>();
  for (const row of members) {
    const index = row.frame?.index ?? -1;
    if (index < 0 || index >= count) continue;
    const held = live.get(index);
    if (!held || outranks(row, held)) live.set(index, row);
  }

  const frames: FrameSlot[] = Array.from({ length: count }, (_, index) => {
    const generation = live.get(index) ?? null;
    return {
      index,
      role: generation?.frame?.role ?? expectedRole(index, count),
      title: generation?.frame?.title ?? "",
      generation,
    };
  });
  return {
    setId,
    brandId,
    kind,
    frames,
    ...(known.leftOut?.length ? { leftOut: known.leftOut } : {}),
  };
}

/** The set with `row` on show at its own index; every other frame kept. */
export function swapFrame(
  set: DesignSet,
  row: SerializedGeneration,
): DesignSet {
  const index = row.frame?.index;
  if (row.frame?.setId !== set.setId || index == null) return set;
  return {
    ...set,
    frames: set.frames.map((slot) =>
      slot.index === index
        ? {
            index,
            role: row.frame?.role ?? slot.role,
            title: row.frame?.title || slot.title,
            generation: row,
          }
        : slot,
    ),
  };
}

/**
 * A fresher read of a set already on screen. Per index the row that
 * outranks wins, so a frame regenerated here is not undone by a gallery
 * read taken before it landed; `incoming` says which frames are stalled.
 */
export function mergeSets(held: DesignSet, incoming: DesignSet): DesignSet {
  if (held.setId !== incoming.setId) return incoming;
  /* A gallery read knows nothing of what the job left out. */
  const leftOut = incoming.leftOut ?? held.leftOut;
  return {
    ...incoming,
    ...(leftOut ? { leftOut } : {}),
    frames: incoming.frames.map((slot) => {
      const mine = held.frames[slot.index]?.generation;
      const theirs = slot.generation;
      if (!mine || (theirs && !outranks(mine, theirs))) return slot;
      return { ...slot, generation: mine, stalled: undefined };
    }),
  };
}

const LEFT_OUT_REASONS: Record<LeftOutFrame["reason"], string> = {
  empty: "it still said “Add a point”, so there was nothing to put on it",
  fault:
    "we couldn't word it in a way that passed our checks, and we don't deliver a slide that fails them",
};

/** What a finished job left out, by framesDropped, each named where the
 *  result's framesLeftOut says; a result stored before it gives indexes
 *  only. */
export function leftOutOf(
  result: Pick<SequenceJobResult, "framesDropped" | "framesLeftOut">,
): LeftOutFrame[] {
  const named = result.framesLeftOut ?? [];
  return (result.framesDropped ?? []).map(
    (index) =>
      named.find((f) => f.index === index) ?? {
        index,
        title: "",
        reason: "fault" as const,
      },
  );
}

/** One sentence per frame the set left out, saying which slide and why,
 *  and the line over them; null when nothing was left out. */
export function leftOutNotice(
  set: DesignSet,
): { summary: string; slides: string[] } | null {
  const leftOut = set.leftOut ?? [];
  if (leftOut.length === 0) return null;
  const delivered = set.frames.length;
  const asked = delivered + leftOut.length;
  const noun = kindNoun(set.kind);
  const summary =
    leftOut.length === 1
      ? `We left 1 slide out, so your ${noun} has ${delivered} slides, not ${asked}. You aren't charged for it.`
      : `We left ${leftOut.length} slides out, so your ${noun} has ${delivered} slides, not ${asked}. You aren't charged for them.`;
  const slides = leftOut.map((frame) => {
    const name = frame.title.trim()
      ? `Slide ${frame.index + 1}, “${frame.title.trim()}”`
      : `Slide ${frame.index + 1}`;
    return `${name}: ${LEFT_OUT_REASONS[frame.reason]}.`;
  });
  return { summary, slides };
}

export function readyFrames(set: DesignSet): SerializedGeneration[] {
  return set.frames.flatMap((slot) =>
    frameState(slot) === "ready" && slot.generation ? [slot.generation] : [],
  );
}

/** The cover a gallery shows: the hook, or the first frame that rendered. */
export function coverOf(set: DesignSet): SerializedGeneration | null {
  const ready = set.frames.filter(
    (slot) => frameState(slot) === "ready" && slot.generation?.url,
  );
  return (
    ready.find((slot) => slot.role === "hook")?.generation ??
    ready[0]?.generation ??
    null
  );
}

export type DownloadFormat = "zip" | "pdf";

export function setDownloadUrl(set: DesignSet, format: DownloadFormat): string {
  const query = new URLSearchParams({ brandId: set.brandId, format });
  return `/api/design/sets/${encodeURIComponent(set.setId)}/download?${query}`;
}

export type GalleryItem =
  | { type: "design"; generation: SerializedGeneration }
  | { type: "set"; set: DesignSet };

/**
 * The history grid's items: every frame of a set folded into one item, at
 * the place its newest row held, and single designs passed through exactly
 * as they came. A set keeps its failed frames, because the viewer offers to
 * retry them, and a set with no frame to put on its cover still gets its
 * card: one that failed outright says so, one still being made says that.
 */
export function groupGallery(
  brandId: string,
  generations: SerializedGeneration[],
): GalleryItem[] {
  const bySet = new Map<string, SerializedGeneration[]>();
  for (const generation of generations) {
    const setId = generation.frame?.setId;
    if (!setId) continue;
    const rows = bySet.get(setId) ?? [];
    if (!rows.some((r) => r.id === generation.id)) rows.push(generation);
    bySet.set(setId, rows);
  }

  const placed = new Set<string>();
  const items: GalleryItem[] = [];
  for (const generation of generations) {
    const setId = generation.frame?.setId;
    if (!setId) {
      items.push({ type: "design", generation });
      continue;
    }
    if (placed.has(setId)) continue;
    placed.add(setId);
    const set = buildSet(brandId, bySet.get(setId) ?? [], { setId });
    if (set) items.push({ type: "set", set });
  }
  return items;
}
