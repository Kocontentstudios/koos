import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { OutlineSource, SequenceKind } from "./contract";

/**
 * Ties an approved outline to the outline the server planned (O4). The
 * planner's own words come back from the client looking exactly like an
 * owner's sentence, so text alone cannot tell them apart: a hook angle
 * the model wrote ("hemmed to your exact length") would be recomputed as
 * "user", counted as stated and kept by force. Each planned point carries
 * an HMAC over its kind, the brief, its source and its words; a point that
 * comes back with its signature intact keeps the source it was planned
 * with, and only words the owner changed become "user".
 */

const SIG_PREFIX = "o1.";

let fallbackKey: Buffer | null = null;

/* OUTLINE_SIGNING_SECRET where set. Every server already holds
   DATABASE_URL as a secret, so a key derived from it works across
   instances with no new deploy step; a per-process key is the last resort
   (tests, scripts), where a signature only survives within one process. */
function signingKey(): Buffer {
  const secret = process.env.OUTLINE_SIGNING_SECRET?.trim();
  if (secret) return createHash("sha256").update(secret).digest();
  const database = process.env.DATABASE_URL?.trim();
  if (database) {
    return createHash("sha256")
      .update(`koos-outline-signing\n${database}`)
      .digest();
  }
  fallbackKey ??= randomBytes(32);
  return fallbackKey;
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

export interface SignedPointInput {
  kind: SequenceKind;
  briefText: string;
  source: OutlineSource;
  point: string;
}

/** The signature a planned point carries back to the server. */
export function signPoint({
  kind,
  briefText,
  source,
  point,
}: SignedPointInput): string {
  const brief = createHash("sha256").update(flat(briefText)).digest("hex");
  const mac = createHmac("sha256", signingKey())
    .update([kind, brief, source, flat(point)].join("\n"))
    .digest("base64url");
  return `${SIG_PREFIX}${mac}`;
}

/** The source a point was planned with, when `sig` is the server's own
 *  signature over these words; null for words the planner never wrote
 *  for this brief. "user" is never returned: the planner writes none. */
export function signedSource(
  input: Omit<SignedPointInput, "source">,
  sig: string | undefined,
): Exclude<OutlineSource, "user"> | null {
  if (!sig?.startsWith(SIG_PREFIX)) return null;
  const given = Buffer.from(sig);
  for (const source of ["brief", "profile"] as const) {
    const want = Buffer.from(signPoint({ ...input, source }));
    if (want.length === given.length && timingSafeEqual(want, given)) {
      return source;
    }
  }
  return null;
}
