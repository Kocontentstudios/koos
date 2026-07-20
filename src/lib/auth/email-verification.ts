import { createHash, randomBytes } from "node:crypto";

/* Dependency-injected business rules (same pattern as
   src/lib/auth/password-reset.ts): pure logic here, DB/SMTP wiring in the
   callers, unit tests against mocks. */

export const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function hashVerificationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Raw token goes in the emailed link; only its hash is stored. */
export function generateVerificationToken(): {
  token: string;
  tokenHash: string;
} {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashVerificationToken(token) };
}

export interface RequestVerificationDeps {
  createEmailVerificationToken: (input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<unknown>;
  sendVerificationEmail: (args: {
    to: string;
    input: { firstName: string; verifyUrl: string };
  }) => Promise<void>;
  buildVerifyUrl: (token: string) => string;
}

/** Issue a verification token and email the link. Throws if the email cannot
 * be sent — callers decide whether that is fatal (resend) or logged (signup). */
export async function requestVerification(
  deps: RequestVerificationDeps,
  user: { id: string; firstName: string; email: string },
): Promise<void> {
  const { token, tokenHash } = generateVerificationToken();
  await deps.createEmailVerificationToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
  });
  await deps.sendVerificationEmail({
    to: user.email,
    input: { firstName: user.firstName, verifyUrl: deps.buildVerifyUrl(token) },
  });
}

export interface PerformVerificationDeps {
  getEmailVerificationTokenByHash: (
    hash: string,
  ) => Promise<
    | { id: string; userId: string; expiresAt: Date; usedAt: Date | null }
    | undefined
  >;
  markEmailVerificationTokenUsed: (id: string) => Promise<void>;
  markEmailVerified: (userId: string) => Promise<void>;
}

export type VerificationResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" };

export async function performVerification(
  deps: PerformVerificationDeps,
  token: string,
): Promise<VerificationResult> {
  const row = await deps.getEmailVerificationTokenByHash(
    hashVerificationToken(token),
  );
  if (!row || row.usedAt) return { ok: false, reason: "invalid" };
  if (row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  // Burn the token before flipping the flag: if the update throws, the link
  // is dead (safe, re-requestable) rather than replayable.
  await deps.markEmailVerificationTokenUsed(row.id);
  await deps.markEmailVerified(row.userId);
  return { ok: true, userId: row.userId };
}
