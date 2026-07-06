import {
  generateResetToken,
  hashResetToken,
  RESET_TOKEN_TTL_MS,
} from "./reset-token";

export interface RequestResetDeps {
  getUserByEmail: (
    email: string,
  ) => Promise<{ id: string; firstName: string; email: string } | undefined>;
  createPasswordResetToken: (input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) => Promise<unknown>;
  sendPasswordResetEmail: (args: {
    to: string;
    input: { firstName: string; resetUrl: string };
  }) => Promise<void>;
  buildResetUrl: (token: string) => string;
}

/** Issue a reset token and email the link. Silently no-ops for unknown
 * emails so the caller can always report generic success (no enumeration). */
export async function requestReset(
  deps: RequestResetDeps,
  email: string,
): Promise<void> {
  const user = await deps.getUserByEmail(email);
  if (!user) return;
  const { token, tokenHash } = generateResetToken();
  await deps.createPasswordResetToken({
    userId: user.id,
    tokenHash,
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });
  await deps.sendPasswordResetEmail({
    to: user.email,
    input: { firstName: user.firstName, resetUrl: deps.buildResetUrl(token) },
  });
}

export interface PerformResetDeps {
  getPasswordResetTokenByHash: (
    hash: string,
  ) => Promise<
    | { id: string; userId: string; expiresAt: Date; usedAt: Date | null }
    | undefined
  >;
  updateUserPassword: (
    userId: string,
    passwordHash: string,
  ) => Promise<unknown>;
  markPasswordResetTokenUsed: (id: string) => Promise<void>;
  invalidateUserSessions: (userId: string) => Promise<void>;
  hashPassword: (plain: string) => Promise<string>;
}

export type ResetResult = { ok: true } | { ok: false; error: string };

const INVALID_LINK =
  "This reset link is invalid or has expired. Please request a new one.";

export async function performReset(
  deps: PerformResetDeps,
  input: { token: string; password: string },
): Promise<ResetResult> {
  if (input.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const row = await deps.getPasswordResetTokenByHash(
    hashResetToken(input.token),
  );
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: INVALID_LINK };
  }
  const passwordHash = await deps.hashPassword(input.password);
  // Burn the token before updating the password: if a step after this throws,
  // the token is dead (safe) rather than replayable with an already-changed password.
  await deps.markPasswordResetTokenUsed(row.id);
  await deps.updateUserPassword(row.userId, passwordHash);
  await deps.invalidateUserSessions(row.userId);
  return { ok: true };
}
