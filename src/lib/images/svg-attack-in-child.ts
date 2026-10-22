import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Test helper: runs SVG logos through one brand-logo path in a child process
 * (svg-attack-child.mts) and reports how the child ended and what each file
 * did. A librsvg abort would take a vitest worker down with it.
 */

export type SvgPath = "upload" | "logo-colors" | "logo";

export interface SvgPathResult {
  name: string;
  status?: number;
  error?: string | null;
  sentToVisionBytes?: number | null;
  fault?: string | null;
  logoBytes?: number;
  composite?: "drawn" | "empty";
  threw?: string;
  ms: number;
}

export interface SvgChildRun {
  status: number | null;
  signal: NodeJS.Signals | null;
  /** The file being run when the child died, if it died. */
  lastStarted: string | null;
  results: Record<string, SvgPathResult>;
  stderr: string;
}

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CHILD = fileURLToPath(new URL("./svg-attack-child.mts", import.meta.url));

export function runSvgPathInChild(
  path: SvgPath,
  files: { name: string; bytes: Uint8Array }[],
  { timeoutMs = 300_000 }: { timeoutMs?: number } = {},
): SvgChildRun {
  const dir = mkdtempSync(join(tmpdir(), "svg-attack-"));
  try {
    const manifest = files.map(({ name, bytes }, i) => {
      const file = `${i}.svg`;
      writeFileSync(join(dir, file), bytes);
      return { file, name };
    });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    const child = spawnSync(
      process.execPath,
      ["--import", "tsx", CHILD, path, dir],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        timeout: timeoutMs,
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    const results: Record<string, SvgPathResult> = {};
    for (const [, json] of child.stdout.matchAll(/^RESULT (.+)$/gm)) {
      const result = JSON.parse(json) as SvgPathResult;
      results[result.name] = result;
    }
    const started = [...child.stderr.matchAll(/^START (.+)$/gm)];
    return {
      status: child.status,
      signal: child.signal,
      lastStarted: started.at(-1)?.[1] ?? null,
      results,
      stderr: child.stderr,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
