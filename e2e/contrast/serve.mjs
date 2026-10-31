import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Starts `next dev` for the contrast lane and keeps its output in a file as
 * well as on the console. A Server Component that crashes renders its error
 * boundary in the browser, but the reason ("Event handlers cannot be passed to
 * Client Component props") is only ever printed by the server, so the lane
 * reads this log (server-log.ts) and fails on it.
 *
 * next dev holds every compiled route in memory. With NODE_OPTIONS capping its
 * heap, a full lane can run it out of memory, and V8 then ends the process.
 * That is the cap doing its job, not the app failing, so the server is
 * started again (at most five times) and the lane, which retries a page load
 * that found no server, carries on. Each restart is written to the log.
 *
 * Usage: node e2e/contrast/serve.mjs <port> <log file>
 * E2E_WEBPACK=1 adds --webpack: Turbopack refuses a symlinked node_modules,
 * which is how a git worktree usually has one.
 */

const [port = "3417", logFile = "test-results/server.log"] =
  process.argv.slice(2);
mkdirSync(path.dirname(logFile), { recursive: true });
const log = createWriteStream(logFile, { flags: "w" });
const write = (chunk) => {
  process.stdout.write(chunk);
  log.write(chunk);
};

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const args = [next, "dev", "--port", port];
if (process.env.E2E_WEBPACK) args.push("--webpack");

/* Next colours its log when FORCE_COLOR is set (Playwright sets it for the
   web server) even into a pipe, and its colour check reads any FORCE_COLOR
   value, "0" included, as on. NO_COLOR is checked first and always wins.
   server-log.ts strips escapes too; this keeps the saved log readable. */
function plainLogEnv(env) {
  const { FORCE_COLOR: _forced, ...rest } = env;
  return { ...rest, NO_COLOR: "1" };
}

const MAX_RESTARTS = 5;
let restarts = 0;
let stopping = false;
let child;

function start() {
  child = spawn(process.execPath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: plainLogEnv(process.env),
  });
  child.stdout.on("data", write);
  child.stderr.on("data", write);
  child.on("exit", (code, signal) => {
    if (stopping) {
      log.end();
      process.exit(code ?? 0);
    }
    if (restarts >= MAX_RESTARTS) {
      write(`[serve] next dev exited (${code ?? signal}); giving up\n`);
      log.end();
      process.exit(code ?? 1);
    }
    restarts++;
    write(
      `[serve] next dev exited (${code ?? signal}); restart ${restarts} of ${MAX_RESTARTS}\n`,
    );
    start();
  });
}

const stop = (signal) => {
  stopping = true;
  child.kill(signal);
};
process.on("SIGTERM", () => stop("SIGTERM"));
process.on("SIGINT", () => stop("SIGINT"));
start();
