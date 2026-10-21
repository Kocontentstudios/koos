import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test helper: draws each image through next/og in a child process and
 * reports how the child ended. A resvg panic is SIGABRT, which would take a
 * vitest worker (and every test in it) down with it.
 */

export interface ImageToDraw {
  name: string;
  contentType: string;
  bytes: Uint8Array;
}

export type DrawVerdict = "drawn" | "empty" | `threw ${string}`;

export interface ChildRender {
  status: number | null;
  signal: NodeJS.Signals | null;
  /** The image being drawn when the child died, if it died. */
  lastStarted: string | null;
  verdicts: Record<string, DrawVerdict>;
  stderr: string;
}

const CHILD = fileURLToPath(
  new URL("./render-gate-child.mjs", import.meta.url),
);

export function renderInChild(
  images: ImageToDraw[],
  { timeoutMs = 120_000 } = {},
): ChildRender {
  const dir = mkdtempSync(join(tmpdir(), "render-gate-"));
  try {
    const manifest = images.map(({ name, contentType, bytes }, i) => {
      const file = `${i}.bin`;
      writeFileSync(join(dir, file), bytes);
      return { file, name, contentType };
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));

    const child = spawnSync(process.execPath, [CHILD, dir], {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 64 * 1024 * 1024,
    });
    const started = [...child.stderr.matchAll(/^START (.+)$/gm)];
    const lastLine = child.stdout.trim().split("\n").pop() ?? "";
    return {
      status: child.status,
      signal: child.signal,
      lastStarted: started.at(-1)?.[1] ?? null,
      verdicts: child.status === 0 ? JSON.parse(lastLine) : {},
      stderr: child.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
