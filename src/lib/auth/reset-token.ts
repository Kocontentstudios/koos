import { createHash, randomBytes } from "node:crypto";

export const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Raw token goes in the emailed link; only its hash is stored. */
export function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashResetToken(token) };
}
