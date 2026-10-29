/** Probe limit for tests. Production keeps 10s, which a cold render worker
 *  outlasted under a loaded suite (worker start and fallback-face fetches
 *  count against it) and failed the gate with no loop present. */
export const TEST_PROBE_LIMIT_MS = 60_000;
