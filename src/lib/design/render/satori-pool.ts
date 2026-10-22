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
 * in a worker instead. When it overruns, the worker is terminated, the
 * caller gets RenderTimeoutError, and the next render starts a fresh one.
 *
 * One worker, reused: a task costs a structured clone of a small element
 * tree and of the PNG back, and each face is copied to a worker once.
 */

/** Code the job surfaces as a quality fault. */
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
  message: unknown;
  limitMs: number;
  resolve(bytes: Uint8Array): void;
  reject(error: Error): void;
}

interface Slot {
  worker: Worker;
  /** Face ids this worker already holds. */
  faces: Set<number>;
}

const faceIds = new WeakMap<ArrayBuffer, number>();
let nextFaceId = 1;
let nextTaskId = 1;
let slot: Slot | null = null;
let running: {
  task: Task;
  timer: NodeJS.Timeout;
  started: number;
  on: Slot;
} | null = null;
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

function spawn(): Slot {
  const worker = new Worker(WORKER_FILE);
  stats.spawns += 1;
  const fresh: Slot = { worker, faces: new Set() };
  worker.on(
    "message",
    (reply: { id: number; bytes?: Uint8Array; error?: string }) => {
      if (!running || running.task.id !== reply.id) return;
      const { task, timer, started } = running;
      clearTimeout(timer);
      stats.busyMs += performance.now() - started;
      running = null;
      if (reply.bytes) task.resolve(reply.bytes);
      else task.reject(new Error(reply.error ?? "render failed"));
      pump();
    },
  );
  /* A worker that dies (out of memory, a native abort) fails the task it was
     running, never the process; the next task gets a new worker. */
  worker.on("error", (error: Error) => failRunning(fresh, error));
  worker.on("exit", (code) => {
    if (slot === fresh) slot = null;
    if (code !== 0) failRunning(fresh, new Error(`renderer exited (${code})`));
  });
  worker.unref();
  return fresh;
}

/* The worker keeps every face it is sent, and brand fonts differ per brand,
   so a long-lived server would hold them all. Past this many it is replaced
   between tasks; the bundled faces are resent, a few hundred KB. */
export const MAX_FACES_PER_WORKER = 48;

function retire(old: Slot) {
  if (slot === old) slot = null;
  stats.retired += 1;
  void old.worker.terminate();
}

function failRunning(from: Slot, error: Error) {
  if (slot === from) slot = null;
  if (!running || running.on !== from) return;
  const { task, timer } = running;
  clearTimeout(timer);
  running = null;
  task.reject(error);
  pump();
}

function pump() {
  if (running) return;
  const task = queue.shift();
  if (!task) return;
  if (slot && slot.faces.size > MAX_FACES_PER_WORKER) retire(slot);
  slot ??= spawn();
  const current = slot;
  const message = task.message as {
    fonts: { id: number; data?: ArrayBuffer }[];
  };
  const fonts = message.fonts.map((font) =>
    current.faces.has(font.id) ? { ...font, data: undefined } : font,
  );
  for (const font of message.fonts) current.faces.add(font.id);
  const timer = setTimeout(() => {
    stats.timeouts += 1;
    running = null;
    slot = null;
    /* terminate() stops a worker mid-instruction, which is the only way out
       of a loop that never yields. */
    void current.worker.terminate();
    task.reject(new RenderTimeoutError(task.limitMs));
    pump();
  }, task.limitMs);
  running = { task, timer, started: performance.now(), on: current };
  stats.tasks += 1;
  current.worker.postMessage({ ...message, id: task.id, fonts });
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
 *  time the worker spent busy. */
export function renderPoolStats() {
  return { ...stats, queued: queue.length };
}

/** Stops the worker. Tests and scripts that want a clean exit call it; a
 *  server never needs to, because the worker does not hold the process. */
export async function closeRenderPool(): Promise<void> {
  const current = slot;
  slot = null;
  if (current) await current.worker.terminate();
}
