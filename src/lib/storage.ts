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
  referenceImages: "reference-images",
  deliverables: "deliverables",
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

/** Fetch an object's raw bytes (e.g. to bundle into a zip). */
export async function getObjectBytes(key: string): Promise<Buffer> {
  const res = await client().send(
    new GetObjectCommand({ Bucket: env("R2_BUCKET"), Key: key }),
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object: ${key}`);
  return Buffer.from(bytes);
}

/** Short-lived signed GET URL, for private objects. */
export async function getSignedReadUrl(
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  return presign(
    client(),
    new GetObjectCommand({ Bucket: env("R2_BUCKET"), Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
