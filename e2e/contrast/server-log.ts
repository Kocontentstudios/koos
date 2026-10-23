import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The dev server's output, which serve.mjs writes to a file. A Server
 * Component that throws (round 3: "Event handlers cannot be passed to Client
 * Component props") renders an error boundary in the browser, and only the
 * server says why, so the lane reads the log and fails on any error in it.
 *
 * With E2E_BASE_URL (a server you started yourself) set E2E_SERVER_LOG to the
 * file that server writes to; without it the lane fails rather than skipping
 * the check.
 */

export const SERVER_LOG =
  process.env.E2E_SERVER_LOG ??
  (process.env.E2E_BASE_URL ? null : path.join("test-results", "server.log"));

/* Next prints ⨯ before every error it logs: a render that threw, a failed
   server action, a crashed route handler. One kind is the client going away,
   not the server failing: the browser navigates or closes a context while a
   response is still streaming. */
const ERROR =
  /⨯|Event handlers cannot be passed|Functions cannot be passed|Only plain objects/;
const CLIENT_WENT_AWAY =
  /^\s*⨯ (?:Error: The destination stream errored while writing data\.?|\[Error: aborted\]|Error: aborted|Error: read ECONNRESET)\s*$/;

function readLog(): Buffer {
  if (!SERVER_LOG) {
    throw new Error(
      "E2E_BASE_URL is set but E2E_SERVER_LOG is not: point it at the server's output (next dev ... 2>&1 | tee server.log)",
    );
  }
  if (!existsSync(SERVER_LOG)) {
    throw new Error(`the server log ${SERVER_LOG} does not exist`);
  }
  return readFileSync(SERVER_LOG);
}

export function serverLogOffset(): number {
  readLog();
  return statSync(SERVER_LOG as string).size;
}

/** Error lines the server logged after `offset`, each with the line after it
 * (Next prints the message on the ⨯ line and the cause below). */
export function serverErrors(text: string): string[] {
  const lines = text.split("\n");
  const found: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (!ERROR.test(line) || CLIENT_WENT_AWAY.test(line)) continue;
    /* next dev forwards the browser's console to its own log, marked
       [browser]. The lane reads the browser's console directly, and keeps
       the errors its own refused writes cause apart; read here they would
       count twice and without that distinction. */
    if (line.trimStart().startsWith("[browser]")) continue;
    found.push([line, lines[i + 1] ?? ""].join(" | ").trim().slice(0, 400));
  }
  return found;
}

export function serverErrorsSince(offset: number): string[] {
  return serverErrors(readLog().subarray(offset).toString("utf8"));
}
