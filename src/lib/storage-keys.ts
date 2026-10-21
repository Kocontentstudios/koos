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
