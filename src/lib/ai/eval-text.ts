/**
 * Text measurements shared by the paid eval lanes.
 *
 * Two lanes now ask the same questions of model output — did it write a
 * placeholder for a fact nobody supplied, or did it invent one — and the
 * detectors have to agree. A second copy of these patterns would drift, and
 * the one thing worse than no benchmark is two that disagree about what
 * passed.
 */

export function words(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** `[PHONE NUMBER]`, `[VENUE]` — a missing fact named rather than invented. */
export const PLACEHOLDER = /\[[A-Z][A-Z \-/]{2,}\]/g;

/** Long digit runs. In output where no number was supplied, the model produced
 *  one — the failure nobody catches, because it looks finished. Dates and
 *  prices are shorter and are checked by eye. */
export const PHONE_LIKE = /\+?\d[\d\s\-()]{8,}\d/g;

export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[0]);
}

export function suspectNumbersIn(text: string): string[] {
  return [...text.matchAll(PHONE_LIKE)].map((m) => m[0].trim());
}
