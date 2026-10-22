import { generateObject } from "ai";
import type { z } from "zod";
import { getModel } from "@/lib/ai/provider";
import {
  readJpegDimensions,
  readPngDimensions,
} from "@/lib/design/png-dimensions";

/**
 * One structured question about one picture, asked of the reasoning model.
 *
 * The rubric judge (judge.ts) and the plate check (plate-check.ts) both look
 * at pixels; this is the one place that sends them, so both get the same
 * model, the same media sniffing and the same hard timeout.
 */

/** PNG or JPEG, read from the bytes rather than from a caller's content type —
 *  the adapters have returned a JPEG labelled as a PNG before. */
export function imageMediaType(bytes: Uint8Array): string | null {
  if (readPngDimensions(bytes)) return "image/png";
  if (readJpegDimensions(bytes)) return "image/jpeg";
  return null;
}

export async function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  /* The loser of the race still settles. Without a handler its rejection is
     unhandled and crashes the worker that the fail-soft path exists to
     protect. */
  void work.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export interface VisionQuestion<S extends z.ZodTypeAny> {
  schema: S;
  system: string;
  text: string;
  /** Omitted when there is nothing worth showing; the question is then asked
   *  of the words alone. */
  image: { bytes: Uint8Array; mediaType: string } | null;
  maxOutputTokens: number;
  timeoutMs: number;
  /** Names the caller in a timeout error. */
  label: string;
}

/** Throws on a refusal, a timeout or an answer off the schema: every caller
 *  is fail-soft and decides for itself what "no answer" means. */
export async function askVision<S extends z.ZodTypeAny>(
  question: VisionQuestion<S>,
): Promise<z.infer<S>> {
  const { object } = await withTimeout(
    generateObject({
      /* The same feature as the art director whose work is being looked at:
         a critic weaker than the thing it judges is a rubber stamp, and
         "strategy" is the registry's reasoning tier (provider-config.ts). */
      model: getModel("strategy"),
      schema: question.schema,
      maxOutputTokens: question.maxOutputTokens,
      abortSignal: AbortSignal.timeout(question.timeoutMs),
      system: question.system,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: question.text },
            ...(question.image
              ? [
                  {
                    type: "image" as const,
                    image: question.image.bytes,
                    mediaType: question.image.mediaType,
                  },
                ]
              : []),
          ],
        },
      ],
    }),
    question.timeoutMs,
    question.label,
  );
  return object as z.infer<S>;
}
