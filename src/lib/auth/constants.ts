// Zero-dependency auth constants — safe to import from edge middleware
// (no Postgres driver, no node:crypto, no next/headers).
export const SESSION_COOKIE = "ko_session";
export const GOOGLE_STATE_COOKIE = "ko_google_state";
export const GOOGLE_VERIFIER_COOKIE = "ko_google_verifier";
export const WORKSPACE_COOKIE = "ko_workspace";
