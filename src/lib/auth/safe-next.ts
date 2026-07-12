/**
 * Validate a post-auth redirect target: only same-app relative paths.
 * Rejects absolute URLs, protocol-relative (//host), and backslash
 * variants (/\host) that browsers normalize into an authority (CWE-601).
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  return value;
}
