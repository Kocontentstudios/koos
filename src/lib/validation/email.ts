const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lightweight email shape check (not RFC-exhaustive; guards obvious typos). */
export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}
