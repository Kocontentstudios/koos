import type { GenerationStage } from "@/components/design/use-design-generation";
import type { JobStage } from "@/lib/generation/poll-job";
import {
  DESIGN_IMAGE_INPUT_TYPES,
  IMAGE_NOT_USABLE_PREFIX,
  MAX_DESIGN_IMAGE_BYTES,
} from "@/lib/uploads/design-image-limits";

export type ImageSource = "upload" | "ko";

const ALLOWED_TYPES = new Set<string>(DESIGN_IMAGE_INPUT_TYPES);
const ALLOWED_EXTENSIONS = /\.(png|jpe?g|webp)$/i;
const MAX_MB = MAX_DESIGN_IMAGE_BYTES / (1024 * 1024);

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
    return `${file.name} isn't a PNG, JPEG or WEBP. Choose one of those.`;
  }
  if (file.size > MAX_DESIGN_IMAGE_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}. The limit is ${MAX_MB} MB.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface GenerationStep {
  stage: JobStage;
  short: string;
  long: string;
}

const JOB_STAGE_ORDER: JobStage[] = ["brief", "imagery", "render", "checks"];

/* The upload path never runs the imagery stage, so it has no step for it: a
   step that is always skipped would read as something that failed. */
export function generationSteps(source: ImageSource): GenerationStep[] {
  return [
    {
      stage: "brief",
      short: "Brief",
      long: "Writing two directions from your brief",
    },
    ...(source === "ko"
      ? [
          {
            stage: "imagery" as const,
            short: "Imagery",
            long: "Creating imagery for each direction",
          },
        ]
      : []),
    {
      stage: "render",
      short: "Layout",
      long:
        source === "upload"
          ? "Laying out your image in both designs"
          : "Laying out both designs",
    },
    {
      stage: "checks",
      short: "Checks",
      long: "Checking both designs against your brand",
    },
  ];
}

/**
 * Which step is current, from the job's reported stage alone. Before the job
 * reports one it is on the first step; once the job has finished and its rows
 * are being read back, it is on the last. A stage the list has no step for
 * lands on the next step that does exist, so the list never moves backwards.
 */
export function generationStepIndex(
  steps: GenerationStep[],
  stage: GenerationStage | null,
  jobStage: JobStage | null,
): number {
  if (stage === "fetching") return steps.length - 1;
  if (!jobStage) return 0;
  const order = JOB_STAGE_ORDER.indexOf(jobStage);
  const before = steps.filter(
    (step) => JOB_STAGE_ORDER.indexOf(step.stage) < order,
  ).length;
  return Math.min(before, steps.length - 1);
}

/* The server may send the apostrophe typographic; the constant has a plain
   one. */
const plainApostrophes = (s: string) => s.replace(/[‘’]/g, "'");

/** True for every unusable-image failure, from the browser normaliser or the
 *  server loader alike: both start their message with the shared prefix. */
export function isUnusableImageError(message: string | null): boolean {
  return (
    message !== null &&
    plainApostrophes(message).trimStart().startsWith(IMAGE_NOT_USABLE_PREFIX)
  );
}

/**
 * The reason alone, for showing under a heading that already says "This image
 * can't be used": "This image can't be used: it is over 20 MB." becomes "It is
 * over 20 MB." A message without the prefix comes back unchanged.
 */
export function unusableImageReason(message: string): string {
  const plain = plainApostrophes(message).trimStart();
  if (!plain.startsWith(IMAGE_NOT_USABLE_PREFIX)) return message;
  const rest = plain
    .slice(IMAGE_NOT_USABLE_PREFIX.length)
    .replace(/^[\s.:,;–—-]+/, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/* The reasons end by telling the user to choose another image, and the
   recovery button under them says exactly that. Saying it in both reads as
   an echo. Any other remedy ("Choose a smaller image") stays, because it
   says something the button does not. */
const REDUNDANT_REMEDY = /(?:^|(?<=[.!?]))\s*Choose another image\.?\s*$/;

/** The reason to show above a "Choose another image" button. */
export function unusableImageDetail(message: string): string {
  return unusableImageReason(message).replace(REDUNDANT_REMEDY, "").trim();
}

/** Going back from a KO-imagery run changes no image, because none was
 *  chosen; it starts the choice again. */
export function startOverLabel(source: ImageSource | null): string {
  return source === "upload" ? "Change image" : "Start over";
}

const COUNT_WORDS = ["No", "One", "Two", "Three", "Four"];

function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n);
}

export interface ResultsHeading {
  title: string;
  description: string;
}

/**
 * The results heading says what is actually on screen: with one of two
 * directions failed, "Two directions to choose from" is a promise the cards
 * below break.
 */
export function resultsHeading(ready: number, total: number): ResultsHeading {
  if (total === 0) {
    return {
      title: "Your designs",
      description: "Designs from this run appear here.",
    };
  }
  if (ready === total) {
    return total === 1
      ? {
          title: "Your direction is ready",
          description:
            "Download it, send it to the design team, or regenerate it for a different take.",
        }
      : {
          title: `${countWord(total)} directions to choose from`,
          description:
            "Each takes a different approach to the same brief. Download the one you like, send it to the design team, or regenerate either one.",
        };
  }
  const missing = total - ready;
  if (ready === 0) {
    return {
      title:
        total === 2 ? "Neither direction rendered" : "No direction rendered",
      description:
        total === 1
          ? "Regenerate it to try again."
          : total === 2
            ? "Regenerate either one to try again."
            : "Regenerate any of them to try again.",
    };
  }
  return {
    title:
      ready === 1
        ? "One direction is ready"
        : `${countWord(ready)} directions are ready`,
    description:
      missing === 1
        ? "The other didn't render. Use the one that's ready, or regenerate the other for a fresh take."
        : `${countWord(missing)} didn't render. Use what's ready, or regenerate the rest.`,
  };
}
