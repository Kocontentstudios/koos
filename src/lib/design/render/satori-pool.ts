import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import type { LoadedFont } from "./fonts";

/**
 * Satori and resvg off the main thread, with a wall-clock limit.
 *
 * Both are synchronous inside one call: when satori loops (a grapheme wider
 * than the line it must break) the event loop never comes back, so no
 * Promise.race or AbortSignal on the same thread can fire. The render runs
 * in a worker instead. When it overruns, that worker is terminated, the
 * caller gets RenderTimeoutError, and a fresh worker takes its place.
 *
 * Several workers, each reused: one render that runs to its limit holds
 * one worker, and every other tenant's renders keep moving on the rest. A
 * task costs a structured clone of a small element tree and of the PNG
 * back, and each face is copied to a worker once.
 */

/** A render stopped at its time limit. The caller reports it and does not
 *  retry: a second attempt holds a worker for the whole limit again. */
export const RENDER_TIMEOUT = "RENDER_TIMEOUT" as const;

export class RenderTimeoutError extends Error {
  readonly code = RENDER_TIMEOUT;
  constructor(readonly limitMs: number) {
    super(
      `the design took longer than ${Math.round(limitMs / 1000)}s to draw and was stopped`,
    );
    this.name = "RenderTimeoutError";
  }
}

/* A valid document draws in under 3s on a dev machine (schema.ts caps cost);
   the margin is for a loaded host, not for a pathological input. */
export const DEFAULT_RENDER_LIMIT_MS = 20_000;

/** The worker's own file. Resolved from the app root like FONT_DIR, and
 *  traced into the deploy by next.config.ts, because a bundler cannot see a
 *  path handed to a Worker at run time. */
export const WORKER_FILE = join(
  process.cwd(),
  "src/lib/design/render/satori-worker.cjs",
);

type Plain = string | number | PlainElement | Plain[] | null;
interface PlainElement {
  type: string;
  props: Record<string, unknown> & { children?: Plain };
}

/**
 * The element tree as plain data a worker can receive: function components
 * called, fragments flattened, keys and refs dropped. Satori reads `type`
 * and `props` and nothing else, so this is the tree it would have walked.
 */
export function toPlainTree(node: ReactNode): Plain {
  if (node === null || node === undefined || typeof node === "boolean") {
    return null;
  }
  if (typeof node === "string" || typeof node === "number") return node;
  if (Array.isArray(node)) return node.map(toPlainTree);
  if (!isValidElement(node)) return null;
  const { type } = node;
  const props = node.props as Record<string, unknown> & {
    children?: ReactNode;
  };
  if (typeof type === "function") {
    return toPlainTree((type as (p: unknown) => ReactNode)(props));
  }
  if (typeof type !== "string") return toPlainTree(props.children);
  const { children, ...rest } = props;
  return {
    type,
    props: {
      ...rest,
      ...(children === undefined ? {} : { children: toPlainTree(children) }),
    },
  };
}

interface Task {
  id: number;
  message: { fonts: { id: number; data?: ArrayBuffer }[] };
  limitMs: number;
  resolve(bytes: Uint8Array): void;
  reject(error: Error): void;
}

interface Slot {
  worker: Worker;
  /** Face ids this worker already holds. */
  faces: Set<number>;
  running: { task: Task; timer: NodeJS.Timeout; started: number } | null;
}

/* Two keeps one stuck render from stalling everyone else; each worker
   holds its own satori, yoga and resvg (about 60MB), so more is opt-in. */
const DEFAULT_WORKERS = 2;

function poolSize(): number {
  const configured = Number(process.env.KOOS_RENDER_WORKERS);
  return Number.isInteger(configured) && configured >= 2
    ? Math.min(configured, 8)
    : DEFAULT_WORKERS;
}

const faceIds = new WeakMap<ArrayBuffer, number>();
let nextFaceId = 1;
let nextTaskId = 1;
const slots: Slot[] = [];
const queue: Task[] = [];
const stats = { tasks: 0, timeouts: 0, spawns: 0, retired: 0, busyMs: 0 };

function faceId(data: ArrayBuffer): number {
  let id = faceIds.get(data);
  if (id === undefined) {
    id = nextFaceId;
    nextFaceId += 1;
    faceIds.set(data, id);
  }
  return id;
}

function drop(slot: Slot) {
  const at = slots.indexOf(slot);
  if (at !== -1) slots.splice(at, 1);
}

/** Ends the slot's task with `outcome`, frees the slot, starts the next. */
function settle(slot: Slot, outcome: { bytes?: Uint8Array; error?: Error }) {
  const running = slot.running;
  if (!running) return;
  clearTimeout(running.timer);
  stats.busyMs += performance.now() - running.started;
  slot.running = null;
  if (outcome.bytes) running.task.resolve(outcome.bytes);
  else running.task.reject(outcome.error ?? new Error("render failed"));
  pump();
}

function spawn(): Slot {
  const worker = new Worker(WORKER_FILE);
  stats.spawns += 1;
  const slot: Slot = { worker, faces: new Set(), running: null };
  worker.on(
    "message",
    (reply: { id: number; bytes?: Uint8Array; error?: string }) => {
      if (slot.running?.task.id !== reply.id) return;
      settle(
        slot,
        reply.bytes
          ? { bytes: reply.bytes }
          : { error: new Error(reply.error ?? "render failed") },
      );
    },
  );
  /* A worker that dies (out of memory, a native abort) fails the task it was
     running, never the process; the next task gets a new worker. */
  worker.on("error", (error: Error) => {
    drop(slot);
    settle(slot, { error });
  });
  worker.on("exit", (code) => {
    drop(slot);
    settle(slot, { error: new Error(`renderer exited (${code})`) });
  });
  worker.unref();
  slots.push(slot);
  return slot;
}

/* The worker keeps every face it is sent, and brand fonts differ per brand,
   so a long-lived server would hold them all. Past this many it is replaced
   between tasks; the bundled faces are resent, a few hundred KB. */
export const MAX_FACES_PER_WORKER = 48;

function retire(slot: Slot) {
  drop(slot);
  stats.retired += 1;
  void slot.worker.terminate();
}

function idleSlot(): Slot | null {
  for (const slot of [...slots]) {
    if (slot.running) continue;
    if (slot.faces.size > MAX_FACES_PER_WORKER) {
      retire(slot);
      continue;
    }
    return slot;
  }
  return slots.length < poolSize() ? spawn() : null;
}

function start(slot: Slot, task: Task) {
  const fonts = task.message.fonts.map((font) =>
    slot.faces.has(font.id) ? { ...font, data: undefined } : font,
  );
  for (const font of task.message.fonts) slot.faces.add(font.id);
  const timer = setTimeout(() => {
    stats.timeouts += 1;
    /* terminate() stops a worker mid-instruction, which is the only way out
       of a loop that never yields. The slot is gone before its exit event
       arrives, so the task is rejected once, as a timeout. */
    drop(slot);
    void slot.worker.terminate();
    settle(slot, { error: new RenderTimeoutError(task.limitMs) });
  }, task.limitMs);
  slot.running = { task, timer, started: performance.now() };
  stats.tasks += 1;
  slot.worker.postMessage({ ...task.message, id: task.id, fonts });
}

function pump() {
  while (queue.length > 0) {
    const slot = idleSlot();
    if (!slot) return;
    const task = queue.shift();
    if (task) start(slot, task);
  }
}

export interface RenderPngOptions {
  limitMs?: number;
}

/** element to PNG bytes in the render worker. Rejects with the renderer's
 *  own message when satori or resvg throws, and with RenderTimeoutError when
 *  it runs past `limitMs`. */
export function renderPng(
  element: ReactElement,
  canvas: { width: number; height: number },
  fonts: LoadedFont[],
  { limitMs = DEFAULT_RENDER_LIMIT_MS }: RenderPngOptions = {},
): Promise<Uint8Array> {
  const message = {
    element: toPlainTree(element),
    width: canvas.width,
    height: canvas.height,
    fonts: fonts.map((font) => ({
      id: faceId(font.data),
      name: font.name,
      weight: font.weight,
      style: font.style,
      data: font.data,
    })),
  };
  return new Promise((resolve, reject) => {
    queue.push({
      id: nextTaskId++,
      message,
      limitMs,
      resolve,
      reject,
    });
    pump();
  });
}

/** Counters for cost reporting: tasks run, timeouts, workers started, and
 *  time the workers spent busy. */
export function renderPoolStats() {
  return {
    ...stats,
    queued: queue.length,
    workers: slots.length,
    size: poolSize(),
  };
}

/** Stops every worker. Tests and scripts that want a clean exit call it; a
 *  server never needs to, because the workers do not hold the process. */
export async function closeRenderPool(): Promise<void> {
  const all = slots.splice(0);
  await Promise.all(all.map((slot) => slot.worker.terminate()));
}
