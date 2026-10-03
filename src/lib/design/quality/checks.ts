import { readImageDimensions } from "@/lib/design/png-dimensions";

/**
 * What must be true of a rendered design before it reaches the user.
 *
 * Until KOOS-AI-001 the job's success criterion was "at least one variant
 * produced bytes" (run-design-generation.ts). The faults it did detect — an
 * illegible logo, a brand font that fell back — were raised as notifications
 * AFTER the image had been stored and shown. The offline evals already knew
 * how to compute most of this and were never invoked at runtime.
 *
 * Deterministic only. Whether a frame is blank, the wrong shape, or carries an
 * unreadable mark each has one correct answer given the bytes, so none of it
 * is asked of a model. The subjective half — hierarchy, brand fit, freshness —
 * is the judge's job, and runs only when something here has already failed.
 */

export type DesignFaultCode =
  | "unreadable-image"
  | "blank-frame"
  | "wrong-dimensions"
  | "unreadable-logo";

export interface DesignFault {
  code: DesignFaultCode;
  /** In words a correction pass can act on. A code alone cannot tell a model
   *  what to change. */
  detail: string;
}

export interface DesignCheckResult {
  ok: boolean;
  failures: DesignFault[];
}

/**
 * A flat frame compresses to almost nothing, which makes compressed density a
 * reliable proxy without decoding pixels.
 *
 * Measured on this project's own output: a solid 1024x1024 PNG is 0.003 B/px,
 * while the least detailed real design (a soft gradient plate) is 0.622 B/px —
 * a 208x gap. The threshold sits between, ~17x above blank and ~12x below the
 * lowest real sample. Shared with the offline eval so there is one definition.
 */
export const BLANK_MAX_BYTES_PER_PIXEL = 0.05;

export function bytesPerPixel(
  byteLength: number,
  { width, height }: { width: number; height: number },
): number {
  return byteLength / (width * height);
}

/** Same shape, any size: upscaling is routine and harmless, while a different
 *  aspect ratio means the adapter served something other than the canvas that
 *  was asked for — Google substitutes 3:4 for 4:5, for instance. */
const ASPECT_TOLERANCE = 0.02;

export function checkRenderedDesign({
  bytes,
  expected,
  logoLegible,
}: {
  bytes: Uint8Array;
  expected: { width: number; height: number };
  /** False when the compositor measured the mark against its ground and could
   *  not make it read. Already computed; previously only notified. */
  logoLegible: boolean;
}): DesignCheckResult {
  const failures: DesignFault[] = [];

  /* A renderer that returned nothing is a fault to report, not an exception to
     throw while reporting one. */
  if (!bytes?.length) {
    return {
      ok: false,
      failures: [
        {
          code: "unreadable-image",
          detail: "The render returned no image bytes at all.",
        },
      ],
    };
  }

  const size = readImageDimensions(bytes);
  if (!size) {
    failures.push({
      code: "unreadable-image",
      detail: `The render produced ${bytes.length} bytes that are not a readable PNG or JPEG.`,
    });
    return { ok: false, failures };
  }

  if (bytesPerPixel(bytes.length, size) < BLANK_MAX_BYTES_PER_PIXEL) {
    failures.push({
      code: "blank-frame",
      detail: `The frame is flat — ${bytesPerPixel(bytes.length, size).toFixed(4)} bytes per pixel, below the ${BLANK_MAX_BYTES_PER_PIXEL} floor a real design clears. The background came back empty.`,
    });
  }

  const wanted = expected.width / expected.height;
  const got = size.width / size.height;
  if (Math.abs(wanted - got) > ASPECT_TOLERANCE) {
    failures.push({
      code: "wrong-dimensions",
      detail: `Rendered ${size.width}x${size.height}, which is not the shape of the requested ${expected.width}x${expected.height}.`,
    });
  }

  if (!logoLegible) {
    failures.push({
      code: "unreadable-logo",
      detail:
        "The brand mark does not read against what sits behind it, measured from the rendered pixels.",
    });
  }

  return { ok: failures.length === 0, failures };
}
