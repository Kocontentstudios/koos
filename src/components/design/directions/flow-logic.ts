import type { GenerationStage } from "@/components/design/use-design-generation";

export type ImageSource = "upload" | "ko";

export const MAX_DESIGN_IMAGE_BYTES = 20 * 1024 * 1024;
export const DESIGN_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
export const DESIGN_IMAGE_HINT = "PNG, JPG or WEBP, up to 20 MB";

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp)$/i;

/**
 * A courtesy check before any bytes move: the server sniffs the real bytes at
 * generation, so this only saves the user a wasted upload. The extension is
 * consulted because some platforms hand over an empty `file.type`.
 */
export function designImageProblem(file: File): string | null {
  const typeOk = file.type
    ? ALLOWED_TYPES.has(file.type)
    : ALLOWED_EXTENSIONS.test(file.name);
  if (!typeOk) {
    return `${file.name} isn't a PNG, JPG or WEBP. Choose one of those.`;
  }
  if (file.size > MAX_DESIGN_IMAGE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}. The limit is 20 MB.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** WEBP is re-encoded to JPEG before upload, so the stored name must say so. */
export function uploadNameFor(
  originalName: string,
  type: "image/png" | "image/jpeg",
): string {
  const base = originalName.replace(/\.[^.]+$/, "") || "image";
  return `${base}.${type === "image/png" ? "png" : "jpg"}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface GenerationStep {
  short: string;
  long: string;
}

export function generationSteps(source: ImageSource): GenerationStep[] {
  return [
    { short: "Brief", long: "Reading your brief and Brand Brain" },
    { short: "Directions", long: "Art-directing two different directions" },
    source === "upload"
      ? { short: "Layout", long: "Laying out your image in both designs" }
      : {
          short: "Imagery",
          long: "Creating imagery and laying out both designs",
        },
    { short: "Finish", long: "Getting your designs ready" },
  ];
}

/**
 * Maps the job's real progress onto the four visible steps. The worker reports
 * done=0 while it art-directs and counts up as designs render, so the first
 * report moves past "Brief", any completed unit means rendering is under way,
 * and "fetching" only happens once the job itself has finished.
 */
export function generationStepIndex(
  stage: GenerationStage | null,
  progress: { done: number; total: number } | null,
): number {
  if (stage === "fetching") return 3;
  if (stage !== "running" || !progress) return 0;
  return progress.done >= 1 ? 2 : 1;
}

/**
 * The server fails a run whose stored bytes are not PNG or JPEG with this
 * sentence. Matched loosely because the apostrophe may arrive typographic.
 */
export function isUnusableImageError(message: string | null): boolean {
  return message !== null && /image can.t be used/i.test(message);
}
