import { cookies } from "next/headers";
import { SESSION_COOKIE, validateSessionToken } from "./session";

/**
 * Resolve the currently authenticated user from the session cookie.
 * Returns `{ dbUser: null }` when there is no valid session.
 */
export async function getAuthUser() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return { dbUser: null };

  const result = await validateSessionToken(token);
  return { dbUser: result?.user ?? null };
}
