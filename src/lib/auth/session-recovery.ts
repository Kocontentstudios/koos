import { safeNext } from "./safe-next";

export interface SessionRecoveryDeps {
  validateSessionToken: (token: string) => Promise<unknown | null>;
}

export interface SessionRecoveryResult {
  clearCookie: boolean;
  redirectTo: string;
}

const LOGIN_PATH = "/login";

/* Only login targets are honored: the clear handler exists solely to break the
 * dead-cookie redirect loop on the way to /login, and constraining `next`
 * keeps it from doubling as a generic internal bounce. */
function normalizeNext(value: unknown): string {
  const next = safeNext(value);
  if (!next) return LOGIN_PATH;
  if (next !== LOGIN_PATH && !next.startsWith(`${LOGIN_PATH}?`)) {
    return LOGIN_PATH;
  }
  return next;
}

/**
 * Decide how to recover a browser whose ko_session cookie may be dead.
 * A still-valid session is bounced to /dashboard untouched so a cross-site
 * GET to the clear endpoint can never force-logout a live user.
 */
export async function resolveSessionRecovery(
  deps: SessionRecoveryDeps,
  input: { token: string | undefined; next: unknown },
): Promise<SessionRecoveryResult> {
  const next = normalizeNext(input.next);
  if (!input.token) {
    return { clearCookie: false, redirectTo: next };
  }
  const session = await deps.validateSessionToken(input.token);
  if (session) {
    return { clearCookie: false, redirectTo: "/dashboard" };
  }
  return { clearCookie: true, redirectTo: next };
}
