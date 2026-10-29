import { z } from "zod";
import type { SubjectBox } from "@/lib/design/document/subject";
import { askVision, imageMediaType } from "./vision";

/**
 * One look at the image a design is built on, before any copy goes on it.
 *
 * Round 1's KO plates showed a round tart, a round cake and bread rolls for
 * a strawberry mille-feuille, and the design said "mille-feuille" over them.
 * Round 2's showed the product but wrote gibberish brand names on a bottle,
 * and its headlines sat on the pastry because nothing said where the pastry
 * was. So one call, through the same vision path as the judge, answers all
 * of it: is this the product, where is it, what else is in the picture, and
 * is there lettering anywhere.
 */

export const PLATE_CHECK_TIMEOUT_MS = 20_000;
const PLATE_CHECK_MAX_OUTPUT_TOKENS = 600;
/** Long edge sent to the model. A product is recognisable far below the
 *  plate's own size, and a smaller image is a faster, cheaper answer that
 *  stays well inside the provider's per-image limit. */
const CHECK_EDGE = 768;

/* Percentages, not shares: the model places a box more reliably in the
   units people use for it. */
const boxSchema = z
  .object({
    left: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
  })
  .describe(
    "A tight box around it, in percent of the image's width (left, right) and height (top, bottom), 0 to 100.",
  );

/* The model's box is a rough one; the copy keeps this much more space
   around it, as a share of each side. */
const BOX_SLACK = 0.02;

/** A vision box in percent, as a subject box in shares, or null when it is
 *  not a box at all. */
export function subjectBoxFrom(
  box: { left: number; top: number; right: number; bottom: number } | null,
): SubjectBox | null {
  if (!box) return null;
  const values = [box.left, box.top, box.right, box.bottom];
  if (!values.every((v) => Number.isFinite(v))) return null;
  /* Some answers come back in shares despite the instruction. */
  const scale = values.every((v) => v <= 1.0001) ? 1 : 100;
  const clamp = (v: number) => Math.min(1, Math.max(0, v / scale));
  const [left, right] = [box.left, box.right].map(clamp).sort((a, b) => a - b);
  const [top, bottom] = [box.top, box.bottom].map(clamp).sort((a, b) => a - b);
  if (right - left < 0.01 || bottom - top < 0.01) return null;
  const x = Math.max(0, left - BOX_SLACK);
  const y = Math.max(0, top - BOX_SLACK);
  const w = Math.min(1, right + BOX_SLACK) - x;
  const h = Math.min(1, bottom + BOX_SLACK) - y;
  return { x, y, w, h };
}

const plateSchema = z.object({
  mainSubject: z
    .string()
    .describe(
      "What the image actually shows as its main subject, in a few plain words.",
    ),
  showsProduct: z
    .boolean()
    .describe(
      "True only if the named product is clearly visible and recognisable as that product. True when no product is named.",
    ),
  subjectBox: boxSchema,
  visibleItems: z
    .array(z.string())
    .describe(
      "Every distinct thing visible, a few words each: the subject, props, food, drinks, people, setting.",
    ),
  lettering: z
    .boolean()
    .describe(
      "True if anything anywhere in the picture carries letters, words, numbers, a brand name, a logo, or marks that imitate writing: a product, its packaging, a label, a sign, a garment, a wall, a book or its pages, paper, a screen, a poster. Rows of tiny printed lines on a page count. Tiny interface detail on a phone or computer screen that cannot be read as words does not count.",
    ),
  identifiablePerson: z
    .boolean()
    .describe(
      "True if a person's face is visible enough that a viewer could take them for a particular individual. Hands, or a figure seen from behind or far off with no face, do not count.",
    ),
  anyPerson: z
    .boolean()
    .describe(
      "True if any person appears at all, even in part: a face in profile or turned away, a head, a body, a figure in the background or far off. Hands or arms alone do not count.",
    ),
});

/* An event or a service is not an object: a sourdough class is a scene of
   people baking, and asking whether "sourdough baking class" is the main
   subject rejected two correct plates twice (round-4 live critic). */
const sceneSchema = plateSchema.omit({ showsProduct: true }).extend({
  fitsBrief: z
    .boolean()
    .describe(
      "True if the scene plausibly belongs to what the brief promotes: its activity, setting or props fit. It need not show any one object.",
    ),
  publishable: z
    .boolean()
    .describe(
      "True only if the brand would publish this image beside its offer: clean, well kept and appealing. False if anything looks run-down, stained, dirty, cracked, dusty, damaged, derelict or unappetising.",
    ),
  showsObject: z
    .boolean()
    .describe(
      "True if the image shows any distinct object: food such as a loaf or a cake, a tool, a utensil, a device, furniture, a product or packaging. False when it is only texture, surface, fabric, light and space.",
    ),
});

/* Round-6 live critic: an event plate painted a cracked, stone-like loaf
   and a service plate a stained, derelict room. Event and service plates
   are object-free backdrops (imagery.ts), and must be ones a brand would
   publish. */
function sceneRefusal(answer: {
  fitsBrief?: unknown;
  publishable?: unknown;
  showsObject?: unknown;
}): string | null {
  if (answer.publishable === false) {
    return "a scene that looks run-down or unappealing";
  }
  if (answer.showsObject === true) return "an object, not a plain backdrop";
  return null;
}

/** What the brief offers, as the plate is checked for it. */
export type OfferingKind = "product" | "event" | "service";

export interface PlateVerdict {
  shows: boolean;
  /** What the checker saw instead, in its words: fed back into the retry. */
  seen: string;
  /** Where the subject is, for the layout to keep copy off it. */
  subject: SubjectBox | null;
  /** Everything visible, for checking what a reason says the image shows. */
  items: string[];
  /** Writing, real or imitation, painted into the image. */
  lettering: boolean;
  /** A face a viewer could take for a particular person. */
  person: boolean;
  /** Any person at all beyond hands: beside a real person the brief names,
   *  a painted stranger in profile still stands in for them (round-5 live
   *  critic: an AI woman beside "architect Ada Obi" passed as no face). */
  anyPerson: boolean;
}

/* "A person wearing or holding": the round-3 eval saw a man in striped robes
   pass as aso-oke throws. */
const SYSTEM = `You check images for a design studio before a client sees them. The first question is identity: is the thing in the picture the named product? A different item of the same kind (a tart for a mille-feuille, a cake for a pastry, a cushion for a throw, bread for a croissant) is NOT the product, and neither is a person wearing or holding something like it when the product is the object itself. Presentation is NOT the question: the angle, crop, plating, number of pieces, background and lighting do not matter, and a description of how it might look is only a hint to recognise it. Then say where the subject is, list what else is in the picture, and say whether any writing appears: generated images often paint made-up brand names or squiggles that look like text on labels and packaging, and those count. Judge only what is visible.`;

const SCENE_SYSTEM = `You check images for a design studio before a client sees them. The brief promotes an event or a service, not an object, and the image is meant as a plain backdrop of texture, surface, light and space behind the copy. The first question is whether the scene fits it: a customer seeing it beside the brief would recognise its mood and setting as belonging to it. Any reasonable backdrop fits; a scene of something unrelated does not. The second is whether the brand would publish it: anything run-down, stained, dirty, cracked, dusty, damaged, derelict or unappetising would not be. The third is whether it shows any distinct object at all, such as food, a tool, furniture or a device. Then say where the main subject is, list what else is in the picture, say whether any writing appears (generated images often paint made-up brand names or squiggles that look like text on signs, aprons, packaging and walls, and those count), and whether a face could be taken for a particular person. Judge only what is visible.`;

async function smaller(
  bytes: Uint8Array,
): Promise<{ bytes: Uint8Array; mediaType: string } | null> {
  try {
    const { default: sharp } = await import("sharp");
    const out = await sharp(bytes, { failOn: "none" })
      .resize(CHECK_EDGE, CHECK_EDGE, {
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 82 })
      .toBuffer();
    return { bytes: new Uint8Array(out), mediaType: "image/jpeg" };
  } catch {
    const mediaType = imageMediaType(bytes);
    return mediaType ? { bytes, mediaType } : null;
  }
}

/** Null when there is no answer (no readable image, a refusal, a timeout):
 *  the caller keeps the plate and records it as unchecked. */
export async function checkPlateShowsProduct({
  bytes,
  product,
  look,
  kind = "product",
  timeoutMs = PLATE_CHECK_TIMEOUT_MS,
}: {
  bytes: Uint8Array;
  /** Empty when the brief names no product: the look still finds the
   *  subject and any lettering. */
  product: string;
  look: string;
  /** A product is checked for by identity; an event or a service by
   *  whether the scene fits it. */
  kind?: OfferingKind;
  timeoutMs?: number;
}): Promise<PlateVerdict | null> {
  const image = await smaller(bytes);
  if (!image) return null;
  const scene = Boolean(product) && kind !== "product";
  try {
    const answer = scene
      ? await askVision({
          schema: sceneSchema,
          system: SCENE_SYSTEM,
          text: [
            `The brief promotes this ${kind}: ${product}.`,
            look ? `What the designer asked for: ${look}.` : null,
            "Does this scene plausibly belong to it? Say what the main subject actually is, and box it.",
          ]
            .filter(Boolean)
            .join("\n"),
          image,
          maxOutputTokens: PLATE_CHECK_MAX_OUTPUT_TOKENS,
          timeoutMs,
          label: "plate scene check",
        })
      : await askVision({
          schema: plateSchema,
          system: SYSTEM,
          text: [
            product ? `The product: ${product}.` : "No product is named.",
            product && look ? `A hint for recognising it: ${look}.` : null,
            product
              ? "Is the main subject of this image that product, recognisably? Answer true if it is, however it is shot or plated. Say what the main subject actually is, and box the product."
              : "Say what the main subject is, and box it.",
          ]
            .filter(Boolean)
            .join("\n"),
          image,
          maxOutputTokens: PLATE_CHECK_MAX_OUTPUT_TOKENS,
          timeoutMs,
          label: "plate check",
        });
    const shows =
      "fitsBrief" in (answer ?? {})
        ? (answer as { fitsBrief?: unknown }).fitsBrief
        : (answer as { showsProduct?: unknown } | null)?.showsProduct;
    if (typeof shows !== "boolean") return null;
    const refused = scene ? sceneRefusal(answer as object) : null;
    const subject =
      typeof answer.mainSubject === "string" ? answer.mainSubject : "";
    return {
      shows: product ? shows && !refused : true,
      seen: refused ? `${subject} (${refused})` : subject,
      subject: subjectBoxFrom(answer.subjectBox ?? null),
      items: Array.isArray(answer.visibleItems)
        ? answer.visibleItems.filter((i): i is string => typeof i === "string")
        : [],
      lettering: answer.lettering === true,
      person: answer.identifiablePerson === true,
      anyPerson:
        answer.anyPerson === true || answer.identifiablePerson === true,
    };
  } catch (err) {
    console.error("plate check unavailable", err);
    return null;
  }
}

const photoSchema = z.object({
  mainSubject: z
    .string()
    .describe("The photograph's main subject, in a few plain words."),
  subjectBox: boxSchema,
  isPerson: z
    .boolean()
    .describe("True if the main subject is a person or people."),
  faceBox: boxSchema
    .nullable()
    .describe(
      "When the main subject is a person: a tight box around their head and shoulders. Null otherwise.",
    ),
  visibleItems: z
    .array(z.string())
    .describe(
      "Every distinct thing visible, a few words each: the subject, props, food, drinks, people, setting.",
    ),
  heads: z
    .array(boxSchema)
    .optional()
    .describe(
      "A tight box around the head of every person visible anywhere in the photograph, whether or not they are the main subject. Empty when no person appears.",
    ),
  anyPerson: z
    .boolean()
    .optional()
    .describe(
      "True if any person appears at all, even in part: a face in profile or turned away, a head, a body, a figure in the background or far off. Hands or arms alone do not count.",
    ),
});

/* The second, narrower ask when the look saw people and boxed no head. */
const headsSchema = z.object({
  heads: z
    .array(boxSchema)
    .describe(
      "A tight box around the head of every person visible anywhere in the photograph, even in part, at the edge or behind something. Empty only when no person's head is visible at all.",
    ),
});

/* What the look's own words say about people, for an answer that leaves
   anyPerson out. Words for a role a person holds in a scene, never ones
   with another common sense ("model", "head", "face"). */
const PEOPLE_WORDS =
  /\b(?:person|people|persons|man|men|woman|women|boy|boys|girl|girls|child|children|kid|kids|baby|babies|barista|baristas|chef|chefs|baker|bakers|waiter|waiters|waitress|cashier|customer|customers|guest|guests|staff|worker|workers|crowd|couple|family|shopper|shoppers|student|students|vendor|vendors|figure|figures)\b/i;

export interface PhotoLook {
  description: string;
  /** The main subject: the product, or the whole person. */
  subject: SubjectBox | null;
  /** A person's head and shoulders: the part copy may never cover when the
   *  whole person leaves no room for it. */
  face: SubjectBox | null;
  /** Every person's head, the main subject's or not: a crop keeps each
   *  whole or leaves it out (round-8 live critic, cafe: the barista beside
   *  the espresso machine was cut at the frame's edge). */
  heads: SubjectBox[];
  items: string[];
  /** The look says people are in the photo: anyPerson, a person as the
   *  main subject, or a person among what it lists. */
  peopleVisible: boolean;
  /** People were seen and no head boxed, so the look was asked once more
   *  for heads alone (round-10 live verdict, CB2). */
  headsAskedAgain: boolean;
}

/**
 * Where the subject of the client's own photograph is, and what is in it.
 * A cut-out needs none of this: its subject is its visible pixels. Null when
 * there is no answer; the layout then has nothing to keep clear, as before.
 */
export async function lookAtPhoto(
  bytes: Uint8Array,
  timeoutMs = PLATE_CHECK_TIMEOUT_MS,
): Promise<PhotoLook | null> {
  const image = await smaller(bytes);
  if (!image) return null;
  try {
    const answer = await askVision({
      schema: photoSchema,
      system:
        "You look at a client's photograph so a designer can lay text around its subject. Say plainly what the main subject is, box it tightly, box a person's head and shoulders, say whether any person appears at all, box every person's head, and list what is visible. Judge only what is visible.",
      text: "Box the main subject: the product if there is one, otherwise what the photograph is of. Then list what is visible.",
      image,
      maxOutputTokens: PLATE_CHECK_MAX_OUTPUT_TOKENS,
      timeoutMs,
      label: "photo subject",
    });
    const items = Array.isArray(answer?.visibleItems)
      ? answer.visibleItems.filter((i): i is string => typeof i === "string")
      : [];
    const description = [answer?.mainSubject ?? "", ...items].join(", ");
    const peopleVisible =
      answer?.anyPerson === true ||
      answer?.isPerson === true ||
      PEOPLE_WORDS.test(description);
    let heads = boxesFrom(answer?.heads);
    const headsAskedAgain = peopleVisible && heads.length === 0;
    if (headsAskedAgain) heads = await askForHeads(image, timeoutMs);
    return {
      description,
      subject: subjectBoxFrom(answer?.subjectBox ?? null),
      face: answer?.isPerson ? subjectBoxFrom(answer.faceBox ?? null) : null,
      heads,
      items,
      peopleVisible,
      headsAskedAgain,
    };
  } catch (err) {
    console.error("photo subject unavailable", err);
    return null;
  }
}

function boxesFrom(boxes: unknown): SubjectBox[] {
  return (Array.isArray(boxes) ? boxes : [])
    .map((box) => subjectBoxFrom(box ?? null))
    .filter((box): box is SubjectBox => box !== null);
}

/** Every person's head, asked for alone. Empty when the model boxes none
 *  or cannot answer: the caller then treats the heads as unknown. */
async function askForHeads(
  image: { bytes: Uint8Array; mediaType: string },
  timeoutMs: number,
): Promise<SubjectBox[]> {
  try {
    const answer = await askVision({
      schema: headsSchema,
      system:
        "You box people's heads in a client's photograph so a crop never cuts one. Judge only what is visible.",
      text: "Box the head of every person in this photograph, including people at its edges, partly hidden, or in the background.",
      image,
      maxOutputTokens: PLATE_CHECK_MAX_OUTPUT_TOKENS,
      timeoutMs,
      label: "photo heads",
    });
    return boxesFrom(answer?.heads);
  } catch (err) {
    console.error("photo heads unavailable", err);
    return [];
  }
}
