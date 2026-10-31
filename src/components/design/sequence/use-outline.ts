"use client";

import { useCallback, useRef, useState } from "react";
import type { GenerateArgs } from "@/components/design/use-design-generation";
import type {
  PlannedOutline,
  SequenceKind,
} from "@/lib/design/sequence/contract";
import {
  addPoint,
  draftFrom,
  editPoint,
  type MoveDirection,
  movePoint,
  type OutlineDraft,
  type OutlineField,
  removePoint,
  restoreRemoved,
} from "./outline-model";

/** The context fields POST /api/design/outline shares with generate. */
export type OutlineRequest = Omit<
  GenerateArgs,
  "image" | "regenerateOf" | "approvedOutline"
>;

export type OutlineState =
  | { status: "idle" }
  | { status: "loading"; count: number | null }
  | {
      status: "error";
      message: string;
      count: number | null;
      /** Epoch ms before which a retry would only spend another request
       *  against the rate limit; null when it can be retried at once. */
      retryAt: number | null;
    }
  | { status: "empty"; count: number | null }
  | {
      status: "ready";
      draft: OutlineDraft;
      /** The count a re-plan is fetching; the draft stays on screen. */
      replanning: number | null;
      replanError: string | null;
    };

export interface OutlineController {
  kind: SequenceKind;
  state: OutlineState;
  /** Plans once; a draft already on screen is kept. */
  ensure: () => void;
  retry: () => void;
  replan: (count: number) => void;
  edit: (id: string, field: OutlineField, value: string) => void;
  /** Returns the new point's id, or null at the bound. */
  add: () => string | null;
  remove: (id: string) => void;
  /** Brings back the newest deleted point; returns its id, or null. */
  restore: () => string | null;
  move: (id: string, direction: MoveDirection) => void;
  reset: () => void;
}

class OutlineFetchError extends Error {
  constructor(
    message: string,
    readonly retryAt: number | null = null,
  ) {
    super(message);
  }
}

function minutes(seconds: number): string {
  const m = Math.max(1, Math.ceil(seconds / 60));
  return m === 1 ? "a minute" : `${m} minutes`;
}

/* Without a usable Retry-After the wait is unknown, so a short floor still
   stops a double press from spending two requests against the limit. */
const UNKNOWN_RATE_LIMIT_WAIT_S = 30;

async function failureOf(res: Response): Promise<OutlineFetchError> {
  if (res.status === 429) {
    const after = Number(res.headers.get("Retry-After"));
    const known = Number.isFinite(after) && after > 0;
    const waitS = known ? after : UNKNOWN_RATE_LIMIT_WAIT_S;
    return new OutlineFetchError(
      known
        ? `You've planned a lot of outlines this hour. Try again in ${minutes(after)}.`
        : "You've planned a lot of outlines this hour. Try again shortly.",
      Date.now() + waitS * 1000,
    );
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return new OutlineFetchError(
    body.error ?? "KO couldn't plan this outline. Try again.",
  );
}

async function fetchOutline(
  request: OutlineRequest,
  count: number | null,
  signal: AbortSignal,
): Promise<PlannedOutline> {
  let res: Response;
  try {
    res = await fetch("/api/design/outline", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        count == null ? request : { ...request, frames: count },
      ),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new OutlineFetchError(
      "KO couldn't be reached. Check your connection and try again.",
    );
  }
  if (!res.ok) throw await failureOf(res);
  const body = (await res.json().catch(() => null)) as {
    outline?: PlannedOutline;
  } | null;
  if (!body?.outline || !Array.isArray(body.outline.points)) {
    throw new OutlineFetchError("KO couldn't plan this outline. Try again.");
  }
  return body.outline;
}

function messageOf(err: unknown): string {
  return err instanceof OutlineFetchError
    ? err.message
    : "KO couldn't plan this outline. Try again.";
}

export function useOutline(
  kind: SequenceKind,
  request: OutlineRequest,
): OutlineController {
  const [state, setState] = useState<OutlineState>({ status: "idle" });
  /* Every change reads and writes through the ref, so an edit and an add in
     the same tick both land, and add can return the id it minted. */
  const stateRef = useRef(state);
  const commit = useCallback((next: OutlineState) => {
    stateRef.current = next;
    setState(next);
  }, []);
  /* The latest request owns the screen: a re-plan to 7 that lands after a
     re-plan to 4 was asked for must not replace it. */
  const inFlight = useRef<AbortController | null>(null);
  const requestRef = useRef(request);
  requestRef.current = request;

  const begin = useCallback(() => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    return controller;
  }, []);

  const plan = useCallback(
    async (count: number | null) => {
      const controller = begin();
      commit({ status: "loading", count });
      try {
        const outline = await fetchOutline(
          requestRef.current,
          count,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        commit(
          outline.points.length === 0
            ? { status: "empty", count }
            : readyWith(outline),
        );
      } catch (err) {
        if (controller.signal.aborted) return;
        commit({
          status: "error",
          message: messageOf(err),
          count,
          retryAt: err instanceof OutlineFetchError ? err.retryAt : null,
        });
      }
    },
    [begin, commit],
  );

  const ensure = useCallback(() => {
    if (stateRef.current.status === "idle") void plan(null);
  }, [plan]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (
      current.status === "error" &&
      current.retryAt !== null &&
      Date.now() < current.retryAt
    ) {
      return;
    }
    const count =
      current.status === "error" || current.status === "empty"
        ? current.count
        : null;
    void plan(count);
  }, [plan]);

  const replan = useCallback(
    async (count: number) => {
      const current = stateRef.current;
      if (current.status !== "ready") {
        void plan(count);
        return;
      }
      const controller = begin();
      commit({ ...current, replanning: count, replanError: null });
      const keepDraft = (replanError: string) => {
        const now = stateRef.current;
        if (now.status === "ready") {
          commit({ ...now, replanning: null, replanError });
        }
      };
      try {
        const outline = await fetchOutline(
          requestRef.current,
          count,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (outline.points.length === 0) {
          keepDraft(
            "KO couldn't plan that many slides from this brief. Your outline is unchanged.",
          );
        } else {
          commit(readyWith(outline));
        }
      } catch (err) {
        if (controller.signal.aborted) return;
        keepDraft(`${messageOf(err)} Your outline is unchanged.`);
      }
    },
    [begin, commit, plan],
  );

  const update = useCallback(
    (change: (draft: OutlineDraft) => OutlineDraft) => {
      const now = stateRef.current;
      if (now.status !== "ready") return;
      const draft = change(now.draft);
      if (draft !== now.draft) commit({ ...now, draft });
    },
    [commit],
  );

  const edit = useCallback(
    (id: string, field: OutlineField, value: string) =>
      update((draft) => editPoint(draft, id, field, value)),
    [update],
  );

  const add = useCallback((): string | null => {
    let added: string | null = null;
    update((draft) => {
      const result = addPoint(draft);
      added = result.id;
      return result.draft;
    });
    return added;
  }, [update]);

  const remove = useCallback(
    (id: string) => update((draft) => removePoint(draft, id)),
    [update],
  );

  const restore = useCallback((): string | null => {
    let restored: string | null = null;
    update((draft) => {
      const result = restoreRemoved(draft);
      if (result.index !== null)
        restored = result.draft.points[result.index].id;
      return result.draft;
    });
    return restored;
  }, [update]);

  const move = useCallback(
    (id: string, direction: MoveDirection) =>
      update((draft) => movePoint(draft, id, direction)),
    [update],
  );

  const reset = useCallback(() => {
    inFlight.current?.abort();
    inFlight.current = null;
    commit({ status: "idle" });
  }, [commit]);

  return {
    kind,
    state,
    ensure,
    retry,
    replan: (count) => void replan(count),
    edit,
    add,
    remove,
    restore,
    move,
    reset,
  };
}

function readyWith(outline: PlannedOutline): OutlineState {
  return {
    status: "ready",
    draft: draftFrom(outline),
    replanning: null,
    replanError: null,
  };
}
