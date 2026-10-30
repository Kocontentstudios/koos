import { COPY_TARGETS } from "@/lib/jobs/directions/schema";

/**
 * A frame's title is shown to the user on its card and as the viewer's
 * heading (set-model.ts, set-viewer.tsx), so it must read as a name for the
 * frame, never as the planner's working notes. The fix call asks for
 * several versions per frame and the model labels them inside the title
 * ("Roasted in-house — version A", "Reserve yours — B", "Shirts and
 * repairs too (P1)").
 */

/* A version or draft label at the end, with whatever trails it, and the
   prompt's source ids (P1, B2). */
const VERSION_LABEL =
  /\s*[-–—:,([]*\s*(?:\b[Vv]ersion\s+(?:[A-Za-z]|\d+)|\b(?:[Dd]raft|[Oo]ption|[Vv]ariant|[Aa]lt(?:ernative)?)\s+(?:[A-Z]|\d+)|\b[Vv]\d+)\b.*$/;
const SOURCE_ID = /\s*[([]?\b[PB]\d{1,2}\b[)\]]?/g;
/* A version's letter after a dash or in brackets: "Reserve yours — A". */
const VERSION_LETTER = /\s+(?:[-–—:]\s*\(?|\()[A-Da-d1-4]\)?\s*$/;
const DANGLING = /[\s\-–—:,;([]+$/;

/** The words of a title that are the planner's, not the frame's. */
export function titleLeaks(title: string): string[] {
  const leaks: string[] = [];
  const version = VERSION_LABEL.exec(title) ?? VERSION_LETTER.exec(title);
  if (version) leaks.push(version[0].trim());
  for (const id of title.matchAll(SOURCE_ID)) leaks.push(id[0].trim());
  return leaks;
}

/** `title` without a version label or a source id. Empty when nothing of
 *  the frame's own name is left. */
export function cleanTitle(title: string): string {
  return title
    .replace(VERSION_LABEL, "")
    .replace(VERSION_LETTER, "")
    .replace(SOURCE_ID, "")
    .replace(DANGLING, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Whether a title reads as the frame's name: no planner label, and within
 *  the words and characters a card shows. */
export function isCleanTitle(title: string): boolean {
  const trimmed = title.trim();
  return (
    trimmed.length > 0 &&
    titleLeaks(trimmed).length === 0 &&
    trimmed.length <= COPY_TARGETS.title.chars &&
    wordCount(trimmed) <= COPY_TARGETS.title.words + 2
  );
}

/** The title a frame keeps: the proposed one cleaned, when it still reads
 *  as a name, else the one it had. */
export function settledTitle(proposed: string, current: string): string {
  const cleaned = cleanTitle(proposed);
  if (isCleanTitle(cleaned)) return cleaned;
  const kept = cleanTitle(current);
  return kept || cleaned || current.trim();
}
