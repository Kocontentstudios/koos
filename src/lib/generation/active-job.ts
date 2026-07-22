/**
 * Client-side pointer to the in-flight calendar generation job. Persisted in
 * localStorage so the GenerationWatcher (mounted in the dashboard layout) can
 * keep polling — and finally toast — no matter where the user navigates, and
 * can resume watching after a full page reload.
 */

export const ACTIVE_GENERATION_KEY = "koos:active-generation";
export const ACTIVE_GENERATION_EVENT = "koos:generation-started";

export interface ActiveGeneration {
  jobId: string;
  kind: "calendar";
}

export function readActiveGeneration(): ActiveGeneration | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_GENERATION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ActiveGeneration>;
    if (typeof parsed.jobId !== "string" || parsed.kind !== "calendar") {
      return null;
    }
    return { jobId: parsed.jobId, kind: "calendar" };
  } catch {
    return null;
  }
}

/** Persist the job and nudge the watcher in this tab (storage events only
    fire in other tabs). */
export function startActiveGeneration(entry: ActiveGeneration): void {
  try {
    window.localStorage.setItem(ACTIVE_GENERATION_KEY, JSON.stringify(entry));
  } catch {
    // Private mode / quota — the watcher still gets the in-tab event.
  }
  window.dispatchEvent(
    new CustomEvent<ActiveGeneration>(ACTIVE_GENERATION_EVENT, {
      detail: entry,
    }),
  );
}

/** Clear the pointer, but only if it still refers to `jobId` — a newer job
    started elsewhere must not lose its entry. */
export function clearActiveGeneration(jobId: string): void {
  const current = readActiveGeneration();
  if (current && current.jobId !== jobId) return;
  try {
    window.localStorage.removeItem(ACTIVE_GENERATION_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
