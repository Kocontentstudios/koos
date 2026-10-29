import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presign } from "@aws-sdk/s3-request-presigner";
import {
  decodedPathKey,
  keyUnderPrefix,
  STORAGE_PREFIXES,
  type StoragePrefix,
} from "./storage-keys";

/**
 * Cloudflare R2 (S3-compatible) storage. Objects are organized under key
 * prefixes within a single bucket. Logos are public-read (served by URL);
 * private artifacts (deliverables) are read via short-lived signed URLs.
 */
export { STORAGE_PREFIXES, type StoragePrefix };

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
  contentDisposition?: string;
}): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      ContentDisposition: params.contentDisposition,
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
  const key = decodedPathKey(parsed.pathname);
  return key === null ? null : keyUnderPrefix(key, prefix);
}

export class ObjectTooLargeError extends Error {
  constructor(
    readonly key: string,
    readonly maxBytes: number,
  ) {
    super(`Object exceeds ${maxBytes} bytes: ${key}`);
    this.name = "ObjectTooLargeError";
  }
}

/**
 * Fetch an object's raw bytes (e.g. to bundle into a zip).
 *
 * `maxBytes` is for objects a browser wrote through a presigned PUT. The
 * signature binds the size the client claimed, but the server never saw the
 * bytes, and an object written before that binding existed carries no such
 * promise. The cap is a Range request for one byte past the limit rather than
 * a check of the reported length, so the process never buffers more than the
 * cap plus one byte whatever the object.
 */
export async function getObjectBytes(
  key: string,
  opts?: { maxBytes?: number },
): Promise<Buffer> {
  const maxBytes = opts?.maxBytes;
  const res = await client().send(
    new GetObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      ...(maxBytes === undefined ? {} : { Range: `bytes=0-${maxBytes}` }),
    }),
  );
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Empty object: ${key}`);
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) {
    throw new ObjectTooLargeError(key, maxBytes);
  }
  return Buffer.from(bytes);
}

/* The presigner always leaves content-type unsigned and leaves content-length
   unsigned unless asked, so by default one URL accepts any type at any size
   up to R2's 5 GB, and the public domain serves it back as whatever type the
   uploader declared. Naming both here overrides that. */
const SIGNED_UPLOAD_HEADERS = new Set(["content-type", "content-length"]);

/**
 * Short-lived signed PUT URL so the browser uploads directly to R2, bypassing
 * the serverless request-body size limit.
 *
 * The signature binds `contentType` and `sizeBytes`: the PUT must send exactly
 * that Content-Type and exactly that many bytes, or R2 answers 403.
 */
export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  sizeBytes: number,
  expiresInSeconds = 900,
): Promise<string> {
  /* An empty type is dropped from the request before signing, which would
     quietly leave the type unbound again. */
  if (!contentType) throw new Error("A signed upload needs a content type.");
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("A signed upload needs a positive byte size.");
  }
  return presign(
    client(),
    new PutObjectCommand({
      Bucket: env("R2_BUCKET"),
      Key: key,
      ContentType: contentType,
      ContentLength: sizeBytes,
    }),
    { expiresIn: expiresInSeconds, signableHeaders: SIGNED_UPLOAD_HEADERS },
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
