import { readFileSync } from "node:fs";

/**
 * This process's peak resident memory, in MB, for the child processes that
 * measure what one load costs.
 *
 * VmHWM, not resourceUsage().maxRSS: Linux carries the parent's peak RSS at
 * fork into the child's maxRSS, so a child of a 600 MB test worker reports
 * 600 MB whatever it does. VmHWM belongs to the address space exec created.
 */
export function peakRssMB(): number {
  try {
    const status = readFileSync("/proc/self/status", "utf8");
    const hwm = /^VmHWM:\s+(\d+) kB$/m.exec(status);
    if (hwm) return Math.round(Number(hwm[1]) / 1024);
  } catch {}
  return Math.round(process.resourceUsage().maxRSS / 1024);
}
