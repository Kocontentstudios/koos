/**
 * One loadDesignImage of one stored file, in a fresh process, reporting what
 * it cost: wall time, CPU time and the process's peak RSS. Spawned by
 * load-budget.smoke.test.ts, so the number is the load's own and not a test
 * worker's.
 *
 * Usage: node --import tsx load-budget-child.mts <file> <png|jpg>
 * Prints one JSON line. Storage is the real module over a stubbed S3 client.
 */
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { peakRssMB } from "@/lib/images/peak-rss";

process.env.R2_ACCOUNT_ID = "test";
process.env.R2_ACCESS_KEY_ID = "test";
process.env.R2_SECRET_ACCESS_KEY = "test";
process.env.R2_BUCKET = "test";

const [file, ext] = process.argv.slice(2);
const stored = readFileSync(file);

const { S3Client } = await import("@aws-sdk/client-s3");
S3Client.prototype.send = (async (command: { input: { Range?: string } }) => {
  const end = command.input.Range?.match(/-(\d+)$/)?.[1];
  const body = end ? stored.subarray(0, Number(end) + 1) : stored;
  return { Body: { transformToByteArray: async () => new Uint8Array(body) } };
}) as unknown as typeof S3Client.prototype.send;

const { DesignImageError, loadDesignImage } = await import("./design-image");

const BRAND = "3aac081f-cae5-446c-af3a-eaa2dfc3f916";
const key = `design-images/${BRAND}/0f8fad5b-d9cb-469f-a165-70867728950e.${ext}`;

const idleRssMB = process.memoryUsage().rss / 2 ** 20;
const cpuBefore = process.cpuUsage();
const started = performance.now();
let outcome: string;
try {
  const image = await loadDesignImage(key, BRAND);
  outcome = `accepted ${image.width}x${image.height} ${image.bytes.length}`;
} catch (err) {
  if (!(err instanceof DesignImageError)) throw err;
  outcome = `refused ${err.fault}`;
}
const wallMs = performance.now() - started;
const cpu = process.cpuUsage(cpuBefore);
process.stdout.write(
  `${JSON.stringify({
    outcome,
    wallMs: Math.round(wallMs),
    cpuMs: Math.round((cpu.user + cpu.system) / 1000),
    idleRssMB: Math.round(idleRssMB),
    peakRssMB: peakRssMB(),
  })}\n`,
);
