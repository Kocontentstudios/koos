export const EMAIL_UNVERIFIED_ERROR =
  "Please verify your email address to use this feature — check your inbox for the verification link.";

/**
 * Soft-gate for key actions (AI generation, team invites): unverified
 * accounts can browse but not act. Returns a 403 response to send back, or
 * null when the user may proceed.
 */
export function requireVerifiedEmail(dbUser: {
  emailVerifiedAt: Date | null;
}): Response | null {
  if (dbUser.emailVerifiedAt) return null;
  return Response.json({ error: EMAIL_UNVERIFIED_ERROR }, { status: 403 });
}
