/**
 * Bucket key prefixes and the rule that pins a key to them.
 *
 * Split out of storage.ts because that module loads the S3 client, and the
 * design document schema, which the browser editor will import, needs the
 * same pinning without dragging the AWS SDK into a client bundle.
 */

export const STORAGE_PREFIXES = {
  logos: "logos",
  fonts: "fonts",
  referenceImages: "reference-images",
  deliverables: "deliverables",
  generated: "generated",
  /* Onboarding brand guidelines and identity decks. A prefix of their own so
     storageKeyFrom can pin it: the document parser reads bytes BY KEY, and the
     prefix is what stops a caller pointing it at any other object. */
  brandDocs: "brand-docs",
  /* Images a user uploads to build a design around (FEAT-033). Separate from
     reference-images, which are style references the model looks at; these
     are drawn into the design itself. */
  designImages: "design-images",
} as const;

export type StoragePrefix =
  (typeof STORAGE_PREFIXES)[keyof typeof STORAGE_PREFIXES];

/**
 * The key, when it sits under one of the allowed prefixes; otherwise null.
 *
 * The prefix is matched with its trailing slash so `fonts-private/` does not
 * pass for `fonts/`, and any `..` is refused outright: the storage client
 * would happily resolve `logos/../deliverables/x` to another tenant's object.
 *
 * The key must already be decoded. An encoded traversal (`%2e%2e`) checked
 * here and expanded later by a URL parser would pass; storageKeyFrom decodes
 * first (decodedPathKey), and a stored key that never went through a URL is
 * held to isCanonicalKey instead, which has no `%` to decode.
 */
export function keyUnderPrefix(
  key: string,
  prefix: StoragePrefix | readonly StoragePrefix[],
): string | null {
  const allowed: readonly StoragePrefix[] = Array.isArray(prefix)
    ? prefix
    : [prefix as StoragePrefix];
  if (!allowed.some((p) => key.startsWith(`${p}/`))) return null;
  if (key.includes("..")) return null;
  return key;
}

/* Every key the app mints is `{prefix}/{id}/{random}.{ext}` in this alphabet.
   Nothing outside it (`%`, `:`, `?`, `#`, whitespace, bidi controls, an empty
   segment) can appear, so a key that passes cannot be read as a scheme, a
   host, a query or an encoded path by whatever later turns it into a URL. */
const CANONICAL_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9._-]+)+$/;
const DOT_SEGMENT = /(?:^|\/)\.+(?:\/|$)/;

/** True for a key in the exact shape the app writes. Use it for keys that
 *  arrive as data (a stored document) rather than from storageKeyFrom. */
export function isCanonicalKey(key: string): boolean {
  return CANONICAL_KEY.test(key) && !DOT_SEGMENT.test(key);
}

/* Bidi overrides and isolates, zero-width characters and the BOM: invisible,
   and they make two different keys print the same. */
const INVISIBLE = /[\p{Cc}\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/u;

/**
 * The storage key a URL path names, decoded once, or null when the decoded
 * key could still be read as something else.
 *
 * A key left holding a `%` was encoded twice, and the next URL parser to see
 * it would decode it again (`%252e%252e` becomes `..`). Empty segments read
 * as a host (`//evil.example`), `?` and `#` as a query or fragment. Legacy
 * keys may hold characters isCanonicalKey refuses, so this rule is narrower:
 * it refuses only what changes meaning on a second read.
 */
export function decodedPathKey(pathname: string): string | null {
  let key: string;
  try {
    key = decodeURIComponent(pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (!key || /[%?#\\]/.test(key) || INVISIBLE.test(key)) return null;
  if (key.split("/").some((segment) => segment === "")) return null;
  return key;
}
