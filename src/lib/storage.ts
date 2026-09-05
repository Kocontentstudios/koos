import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";

/**
 * Cloudflare R2 (S3-compatible) storage. Objects are organized under key
 * prefixes within a single bucket. Logos are public-read (served by URL);
 * private artifacts (deliverables) are read via short-lived signed URLs.
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
} as const;

export type StoragePrefix =
  (typeof STORAGE_PREFIXES)[keyof typeof STORAGE_PREFIXES];

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

let cached: S3Client | null = null;
function client(): S3Client {
  if (cached) return cached;
  cached = new S3Client({
    region: "auto",
    endpoint: `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env("R2_ACCESS_KEY_ID"),
      secretAccessKey: env("R2_SECRET_ACCESS_KEY"),
    },
  });
  return cached;
}

/** True when the R2 environment is fully configured. */
export function isStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

export async function uploadObject(params: {
  key: string;
  body: Uint8Array | Buffer;
  contentType: string;
}): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
    }),
  );
}

/** Public URL for an object (requires a configured R2 public/custom domain). */
export function publicUrl(key: string): string {
  const base = env("R2_PUBLIC_BASE_URL").replace(/\/$/, "");
  return `${base}/${key}`;
}

/**
 * The bucket key a public URL refers to, or null if it does not belong to the
 * given prefix of our own storage.
 *
 * The inverse of publicUrl, and the only sanctioned way to turn a stored URL
 * back into a key. Every caller of this holds a URL that came out of a
 * user-writable column, so two things have to be proved rather than assumed:
 *
 *  - The origin matches, compared as parsed origins. A `startsWith` test on the
 *    base passes for `https://cdn.example.com.attacker.test/...`, because that
 *    string genuinely starts with the base.
 *  - The key sits under the prefix the caller expects. Without this, a brand
 *    row pointed at `deliverables/<someone-else>/...` reads another tenant's
 *    delivered artwork, and the only reason that is not worse today is that
 *    keys carry 48 bits of randomness.
 */
export function storageKeyFrom(
  url: string | null | undefined,
  prefix: StoragePrefix | StoragePrefix[],
): string | null {
  const base = process.env.R2_PUBLIC_BASE_URL;
  if (!url || !base) return null;
  let parsed: URL;
  let parsedBase: URL;
  try {
    parsed = new URL(url);
    parsedBase = new URL(base);
  } catch {
    return null;
  }
  if (parsed.origin !== parsedBase.origin) return null;

  // Decoded, so an encoded traversal cannot smuggle a different prefix past
  // the check and then be re-expanded by the storage client.
  const key = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
  const allowed = Array.isArray(prefix) ? prefix : [prefix];
  if (!allowed.some((p) => key.startsWith(`${p}/`))) return null;
  if (key.includes("..")) return null;
  return key;
}

/** Fetch an object's raw bytes (e.g. to bundle into a zip). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: env("R2_BUCKET"), Key: key }),
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object: ${key}`);
  return Buffer.from(bytes);
}

/** Short-lived signed PUT URL so the browser uploads directly to R2,
 * bypassing the serverless request-body size limit. */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresInSeconds = 900,
): Promise<string> {
  return presign(
    client(),
    new PutObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      ContentType: contentType,
    }),
    { expiresIn: expiresInSeconds },
  );
}

/** Short-lived signed GET URL, for private objects. */
export async function getSignedReadUrl(
  key: string,
  expiresInSeconds = 3600,
  opts?: { disposition?: "inline" | "attachment"; fileName?: string },
): Promise<string> {
  return presign(
    client(),
    new GetObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      ResponseContentDisposition:
        opts?.disposition === "attachment"
          ? `attachment; filename="${opts.fileName?.replace(/["\\]/g, "\\$&")}"`
          : "inline",
    }),
    { expiresIn: expiresInSeconds },
  );
}
