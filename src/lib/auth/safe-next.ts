/**
 * Validate a post-auth redirect target: only same-app relative paths.
 * Rejects absolute URLs, protocol-relative (//host), backslash variants
 * (/\host), and ASCII control characters (e.g. tab/newline/CR) — the
 * WHATWG URL parser strips those before parsing, so browsers resolve
 * "/\t/evil.com" as protocol-relative "//evil.com" (CWE-601).
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (value.includes("\\")) return null;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — rejecting control chars is the security fix.
  if (/[\x00-\x1f]/.test(value)) return null;
  return value;
}
