import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";
import { SESSION_COOKIE } from "./constants";
import {
  generateSessionToken,
  hashToken,
  SESSION_TTL_MS,
  shouldRefresh,
} from "./session-token";

export { SESSION_COOKIE };

type SessionUser = typeof users.$inferSelect;

/** Create a session row and return the raw token + expiry for the cookie. */
export async function createSession(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

/**
 * Validate a raw session token. Returns the user, or null if the session is
 * missing/expired. Deletes expired sessions and slides valid ones forward.
 */
export async function validateSessionToken(
  token: string,
): Promise<{ user: SessionUser; expiresAt: Date } | null> {
  const id = hashToken(token);
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, id))
    .limit(1);

  if (!row) return null;

  if (Date.now() >= row.expiresAt.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }

  let expiresAt = row.expiresAt;
  if (shouldRefresh(expiresAt)) {
    expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
  }

  return { user: row.user, expiresAt };
}

export async function invalidateSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

// ── Cookie helpers ───────────────────────────────────────────────────

const baseCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
} as const;

export async function setSessionCookie(
  token: string,
  expiresAt: Date,
): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, { ...baseCookie, expires: expiresAt });
}

export async function deleteSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { ...baseCookie, maxAge: 0 });
}

/** Establish a fresh session for a user and set the cookie. */
export async function startSession(userId: string): Promise<void> {
  const { token, expiresAt } = await createSession(userId);
  await setSessionCookie(token, expiresAt);
}

/** Tear down the current session (DB row + cookie). */
export async function endSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await invalidateSession(token);
  await deleteSessionCookie();
}
