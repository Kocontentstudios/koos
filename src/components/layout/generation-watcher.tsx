"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import {
  ACTIVE_GENERATION_EVENT,
  ACTIVE_GENERATION_KEY,
  type ActiveGeneration,
  clearActiveGeneration,
  readActiveGeneration,
} from "@/lib/generation/active-job";
import { pollGenerationJob } from "@/lib/generation/poll-job";

/** Well past the server's 4-minute stale-job detector, which is the real
    bound — this only stops a poll loop the server has already given up on. */
const WATCH_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Invisible dashboard-wide watcher for background calendar generation. Picks
 * up the active job from localStorage (survives navigation and reloads),
 * polls it to a terminal state, and toasts the outcome — so the user can
 * leave the strategy page while their calendar generates.
 */
export function GenerationWatcher() {
  const router = useRouter();
  const watching = useRef<Set<string>>(new Set());

  useEffect(() => {
    const watch = (entry: ActiveGeneration) => {
      if (watching.current.has(entry.jobId)) return;
      watching.current.add(entry.jobId);
      void (async () => {
        try {
          const { calendarId } = await pollGenerationJob<{
            calendarId: string;
          }>(entry.jobId, {
            intervalMs: 4000,
            timeoutMs: WATCH_TIMEOUT_MS,
          });
          toast.success("Your Calendar generation is completed.", {
            duration: 10_000,
            action: {
              label: "View calendar",
              onClick: () => router.push(`/calendar?calendarId=${calendarId}`),
            },
          });
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Calendar generation failed.";
          // A stale pointer (job pruned, signed out) isn't worth a toast.
          if (!/not found/i.test(message)) toast.error(message);
        } finally {
          clearActiveGeneration(entry.jobId);
          watching.current.delete(entry.jobId);
        }
      })();
    };

    // A generation may already be running from before a reload/navigation.
    const existing = readActiveGeneration();
    if (existing) watch(existing);

    const onStart = (e: Event) => {
      const detail = (e as CustomEvent<ActiveGeneration>).detail;
      if (detail?.jobId) watch(detail);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key !== ACTIVE_GENERATION_KEY || !e.newValue) return;
      const entry = readActiveGeneration();
      if (entry) watch(entry);
    };
    window.addEventListener(ACTIVE_GENERATION_EVENT, onStart);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ACTIVE_GENERATION_EVENT, onStart);
      window.removeEventListener("storage", onStorage);
    };
  }, [router]);

  return null;
}
