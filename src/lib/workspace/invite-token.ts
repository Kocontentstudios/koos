import { createHash, randomBytes } from "node:crypto";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Raw token goes in the emailed link; only its hash is stored. */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}
