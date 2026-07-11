import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { hashToken } from "@/lib/auth/session-token";

/**
 * Short, stable identifier for the caller's auth session, used as the
 * `session_id` property on analytics events so funnels can answer
 * "did X and Y happen in the same session?". A 16-char prefix of the session
 * token hash — enough to correlate, useless to replay. Null when logged out.
 */
export async function getAnalyticsSessionId(): Promise<string | null> {
  try {
    const store = await cookies();
    const token = store.get(SESSION_COOKIE)?.value;
    if (!token) return null;
    return hashToken(token).slice(0, 16);
  } catch {
    // cookies() is unavailable outside a request scope.
    return null;
  }
}
