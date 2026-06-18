import { createHash, randomBytes } from "node:crypto";

/** Sessions live 30 days; refreshed when past the halfway mark. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

/** Opaque, high-entropy session token handed to the client (cookie value). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The session row id = SHA-256(token). Only the hash is stored, so a leaked DB
 * snapshot cannot be replayed as a valid session cookie.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sliding-expiry: refresh once the session is more than half-way to expiry. */
export function shouldRefresh(expiresAt: Date, now = Date.now()): boolean {
  return now >= expiresAt.getTime() - SESSION_TTL_MS / 2;
}
