import { createHash, randomUUID } from "node:crypto";
import type { ImageAdapter } from "@/lib/ai/image/types";
import { buildBackgroundPlatePrompt } from "@/lib/ai/prompts/design-spec";
import type { DocumentAsset } from "@/lib/design/document/rasterize";
import type { AssetRef } from "@/lib/design/document/schema";
import {
  checkPlateShowsProduct,
  type OfferingKind,
  type PlateVerdict,
} from "@/lib/design/quality/plate-check";
import type { LoadedLogo } from "@/lib/design/render/logo";
import type { DesignSpec } from "@/lib/design/spec";
import { detectImageType } from "@/lib/images/detect";
import { type ReencodeOptions, reencodeImage } from "@/lib/images/reencode";
import { STORAGE_PREFIXES, uploadObject } from "@/lib/storage";
import { NORMALISED_LONG_EDGE } from "@/lib/uploads/design-image-limits";

/** An image a document draws: the key it names and the bytes behind it. */
export interface PlacedAsset {
  ref: AssetRef;
  asset: DocumentAsset;
}

const DRAWABLE = {
  png: { ext: "png", contentType: "image/png" },
  jpeg: { ext: "jpg", contentType: "image/jpeg" },
} as const;

/** The product the brief names and what it looks like, from the direction. */
export interface PlateProduct {
  name: string;
  look: string;
  /** A product is painted and checked as the subject; an event or a
   *  service as a scene that fits it. */
  kind?: OfferingKind;
}

/** What the plate check concluded, recorded per plate. */
export type PlateCheck =
  /** The first plate shows the product and carries no lettering. */
  | "passed"
  /** The first did not; the one retry did. */
  | "passed-on-retry"
  /** Neither showed the product, so the direction is drawn flat rather than
   *  over the wrong product. */
  | "failed"
  /** Both showed the product with made-up writing painted on it, so the
   *  direction is drawn flat rather than with fake brand names on it. */
  | "failed-lettering"
  /** The brief names a real person and both plates painted a face that
   *  could be taken for them, so the direction is drawn flat. */
  | "failed-people"
  /** The checker could not answer, or there was no product to check it
   *  against (none named, or one the brief never mentions); the plate is
   *  used, unverified. A plate checked only for lettering is not "passed"
   *  (round-3 code critic). */
  | "unchecked"
  /** An object-free scene (an event, a service, or no physical product)
   *  that carries no writing and no people. It shows a place, not the
   *  offering, so nothing may be said about what it shows. */
  | "scene"
  /** The image model returned nothing that could be drawn (it failed, or
   *  sent a format or size the renderer cannot take): no plate was judged
   *  at all, and the user is told the image model was unavailable, not
   *  that its plates were wrong (round-5 code critic). */
  | "unavailable";

export interface CheckedPlate {
  image: { bytes: Uint8Array; contentType: string } | null;
  check: PlateCheck;
  /** Plate-model calls made: 1, or 2 when the first plate was rejected. */
  imageCalls: number;
  /** What the checker saw on each rejected plate. */
  seen: string[];
  /** The check's look at the delivered plate: where the subject is and what
   *  is in it. Null when there is no plate or no answer. */
  look: PlateVerdict | null;
}

/**
 * The plate prompt with the product named first. Image models weigh the
 * start of a prompt most, and round 1's scene-first prompts ("a sunlit
 * bakery counter with a pastry") came back as whatever pastry the model knew
 * best. The first attempt names the product and leaves the direction's own
 * scene to set it apart from its sibling: leading both with the same long
 * description painted the same plate twice. A retry, after the check said
 * the product was missing or lettered, leads with the full description and
 * names what was wrong.
 */
export function platePrompt(
  spec: DesignSpec,
  product: PlateProduct | null,
  rejected?: Rejection,
  setting?: string | null,
  namesPeople = false,
): string {
  if (!product || isSceneKind(product.kind)) {
    return objectFreePrompt(spec, product, rejected, setting);
  }
  const scene = buildBackgroundPlatePrompt({
    ...spec,
    backgroundPrompt: withoutLetteredThings(spec.backgroundPrompt),
  });
  /* Round 2 painted a Lagos bakery's pastry on a European street and wrote
     "MIOCZEBC PRALEF" on a zobo bottle. */
  const place = setting
    ? `Set in ${setting}: its own streets, interiors, people and light`
    : null;
  /* Round-5 eval: phones, laptops and gym walls came back lettered twice
     and five directions were drawn as text; screens and signs are where
     the image model paints writing. The product is kept; what it sits in
     or on is kept free of writing (Oluwaseyi's decision, round 6). */
  const plain = [
    "Any packaging, bottle, box or bag is plain and unbranded, with no label text, printed words, letters or logos, and the surface it sits on is plain",
    /* Unless that is what is sold: a notebook brand's plate shows the
       notebook. */
    LETTERED_THINGS.test(product.name)
      ? "No signs, posters or printed clothing"
      : "No phones, laptops or screens of any kind, no paper, documents, books, menus, cash or charts, no signs, posters or printed clothing",
  ].join(". ");
  /* A painted face beside a named speaker reads as that person (round-3
     live critic: the eval painted a woman for "Ada Obi"). */
  const people = namesPeople
    ? "No people at all, not even in the background, in profile or far off; hands may appear: the brief names real people, and a painted stranger would stand in for them"
    : "Any person is an anonymous passer-by, never posed as a named host, speaker or customer";
  const tail = [scene, place, plain, people].filter(Boolean).join(". ");
  /* Said up front as well: at the end of a long prompt the setting lost to
     the model's default street (round-3 live run, again European). */
  const where = setting ? `, in ${setting}` : "";
  if (!rejected) {
    return `A ${product.name}, clearly recognisable, as the subject${where}. ${tail}`;
  }
  const wrong = rejected.people
    ? "the last attempt painted a person's face, which is wrong: no faces anywhere"
    : rejected.lettering
      ? "the last attempt painted lettering on it, which is wrong: no writing anywhere"
      : `the last attempt showed ${rejected.seen || "something else"} instead, which is wrong`;
  return `${product.look || product.name}. The ${product.name} is the clear subject${where}, whole and unmistakable; ${wrong}. ${tail}`;
}

/** An event, a service, or no physical product: painted as a place, not a
 *  thing. */
export function isSceneKind(kind: OfferingKind | undefined): boolean {
  return kind === "event" || kind === "service";
}

/* Who a scene clause would put in the picture. */
const PEOPLE_WORDS =
  /\b(?:people|persons?|man|men|woman|women|girls?|boys?|child(?:ren)?|kids?|students?|customers?|guests?|clients?|staff|team|crowd|hands?|faces?|baker|barista|chef|teacher|tutor|coach|host|speaker|audience|attendees?|participants?|workers?|someone|friends?|famil(?:y|ies)|couple|athletes?)\b/i;

/**
 * The plate for an event, a service or a brief with no physical product:
 * the place it happens, in light, colour and texture only, with no people
 * and nothing that carries writing. Round 6's eval lost 12 of 21 KO plates
 * to lettering on paper, cash, screens and gym walls and to scenes of
 * people that stood in for a named host; a place with nothing in it to
 * letter or mistake for anyone is what the image model paints cleanly
 * (Oluwaseyi's decision, round 6). The direction's own scene still sets
 * the light and mood, without its people or lettered objects, so two
 * directions do not paint one room twice.
 */
export function objectFreePrompt(
  spec: DesignSpec,
  product: PlateProduct | null,
  rejected?: Rejection,
  setting?: string | null,
): string {
  const mood = spec.backgroundPrompt
    .split(/[.;]\s+|,\s+/)
    .map((clause) => clause.trim().replace(/[.\s]+$/, ""))
    .filter(
      (clause) =>
        clause && !LETTERED_THINGS.test(clause) && !PEOPLE_WORDS.test(clause),
    )
    .join(", ");
  const scene = buildBackgroundPlatePrompt({ ...spec, backgroundPrompt: mood });
  const where = setting ? ` in ${setting}` : "";
  const what = product ? `the ${product.name}${where}` : `the brand${where}`;
  /* Nothing here says what not to paint: told "no writing", the plate
     model painted stencilled words on bare wood (round-6 live run). What
     must not appear goes in the negative prompt (negativeFor). A retry is
     the same request in another light. */
  const retryMood = rejected ? ", seen in soft morning light" : "";
  return [
    `A soft-focus, close-up photograph of light and texture that suits ${what}: one clean material or surface (wood grain, linen, plaster, stone, water, foliage or sky) in warm, well-kept condition${retryMood}`,
    scene.replace(/^[.\s]+/, "").replace(/\.?\s*No text, no letters[^.]*$/, ""),
  ]
    .filter(Boolean)
    .join(". ");
}

/* What a plate must never show. Writing always; people too on an
   object-free scene or beside a named person. */
const NEGATIVE_WRITING =
  "text, letters, words, writing, typography, numbers, signs, signage, labels, logos, watermark, graffiti, stencil, posters, menus, paper, documents, screens";
const NEGATIVE_PEOPLE = "people, person, face, crowd, figure, hands";

export function negativeFor(noPeople: boolean): string {
  return noPeople
    ? `${NEGATIVE_WRITING}, ${NEGATIVE_PEOPLE}`
    : NEGATIVE_WRITING;
}

/* "Speaker: Ada Obi", "hosted by Tunde Bakare", "with Chef Funke". */
const ROLE =
  "speakers?|hosts?|host(?:ed)? by|with|featuring|feat\\.?|by|chef|dr\\.?|mr\\.?|mrs\\.?|ms\\.?|keynote|panell?ists?|guests?|founder|ceo|coach|artist|architect|designer|author|dj|mc|pastor|prof\\.?|professor";
/* Either case for the role ("Speaker:", "with"), never for the name. */
const ANY_CASE_ROLE = ROLE.replace(
  /(^|\|)([a-z])/g,
  (_, bar: string, first: string) => `${bar}[${first}${first.toUpperCase()}]`,
);
const NAMED_PERSON = new RegExp(
  `\\b(?:${ANY_CASE_ROLE})\\s*:?\\s+(?:(?:${ANY_CASE_ROLE})\\s+)?[A-Z][\\p{L}'’-]+\\s+[A-Z][\\p{L}'’-]+`,
  "u",
);

/** Whether the brief names a real person a painted face could stand in
 *  for. */
export function briefNamesPeople(
  briefText: string | null | undefined,
): boolean {
  return NAMED_PERSON.test(briefText ?? "");
}

/* An image model's largest plates (about 3072 x 5504 at 9:16) are past
   the 4096 px the renderer draws (rasterizeDocument refuses them), and far
   past what a 1080 px design needs. Read with room for them; written at
   the long edge uploads are normalised to. */
export const PLATE_REENCODE: ReencodeOptions = {
  maxInputPixels: 8192 * 8192,
  maxOutputSide: NORMALISED_LONG_EDGE,
  minOutputSide: 1080,
};

/** The plate as the renderer may draw it: a PNG or JPEG, re-encoded by
 *  libvips to at most 2560 px on its long edge. Null when it is neither,
 *  or does not decode. */
export async function drawablePlate(
  plate: { bytes: Uint8Array; contentType: string },
  adapterId: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const type = detectImageType(plate.bytes);
  if (type !== "png" && type !== "jpeg") {
    console.error(
      `plate from ${adapterId} came back as ${type ?? plate.contentType}; rendering flat`,
    );
    return null;
  }
  try {
    const fitted = await reencodeImage(plate.bytes, type, PLATE_REENCODE);
    return {
      bytes: new Uint8Array(fitted.bytes),
      contentType: DRAWABLE[type].contentType,
    };
  } catch (err) {
    console.error(`plate from ${adapterId} could not be re-encoded`, err);
    return null;
  }
}

/* What image models paint writing on, whatever the prompt says: round 5's
   service plates were "financial documents (lettered)" four times out of
   four, and its eval lost fintech, recruitment and fitness plates to
   phones, laptops and gym walls. A scene clause naming one is left out of
   the plate prompt; the product, setting and light carry the scene. */
const LETTERED_THINGS =
  /\b(?:documents?|paper(?:work|s)?|receipts?|invoices?|reports?|statements?|spreadsheets?|ledgers?|forms?|contracts?|charts?|graphs?|dashboards?|screens?|monitors?|laptops?|computers?|tablets?|phones?|smartphones?|apps?|interfaces?|signs?|signage|signboards?|posters?|banners?|billboards?|menus?|books?|notebooks?|newspapers?|magazines?|labels?|price tags?|whiteboards?|blackboards?|chalkboards?|calendars?|clipboards?|cv|cvs|résumés?|resumes?|certificates?|cards?|tickets?|envelopes?|letters?|text|words?|writing|lettering|typography|numbers?)\b/i;

/** `scene` without the clauses that ask for something image models letter. */
export function withoutLetteredThings(scene: string): string {
  const clauses = scene
    .split(
      /(?<=[.;])\s+|,\s+(?=(?:with|and|on|beside|near|showing|holding|where)\b)/i,
    )
    .map((c) => c.trim())
    .filter(Boolean);
  const kept = clauses.filter((c) => !LETTERED_THINGS.test(c));
  return kept.join(" ");
}

interface Rejection {
  seen?: string;
  lettering?: boolean;
  people?: boolean;
}

/* A painted face beside a named speaker reads as that person, so with a
   person named a face is a rejection like the wrong product (round-4 live
   critic: an AI woman beside "with Ada Obi", twice). */
function rejection(
  verdict: PlateVerdict,
  product: PlateProduct | null,
  namesPeople: boolean,
): Rejection | null {
  /* An object-free scene is checked for what it must not hold: writing and
     people. Whether an empty room "fits" a class is not a question it can
     fail usefully. */
  if (!product || isSceneKind(product.kind)) {
    if (verdict.lettering) return { lettering: true };
    if (verdict.person || verdict.anyPerson) return { people: true };
    return null;
  }
  if (!verdict.shows) return { seen: verdict.seen };
  if (verdict.lettering) return { lettering: true };
  if (namesPeople && (verdict.person || verdict.anyPerson)) {
    return { people: true };
  }
  return null;
}

function failedAs(rejected: Rejection): PlateCheck {
  if (rejected.people) return "failed-people";
  if (rejected.lettering) return "failed-lettering";
  return "failed";
}

/**
 * Paints one plate and looks at it (quality/plate-check.ts): does it show
 * the product the brief names, where is it, and is there writing on it. A
 * rejected plate is painted once more with what was wrong named; if that
 * one is rejected too the direction is drawn flat. A design on a brand
 * colour is honest; the wrong product, or the right one wearing a made-up
 * brand name, is not.
 *
 * Null image on any plate-model failure, as the composite route does: a
 * design without a plate beats no design. That includes a plate satori
 * cannot draw (WEBP), which would otherwise fail the render deep inside with
 * "u2 is not iterable".
 */
export async function paintCheckedPlate({
  adapter,
  spec,
  product,
  productUnchecked = false,
  setting = null,
  namesPeople = false,
}: {
  adapter: ImageAdapter;
  spec: DesignSpec;
  product: PlateProduct | null;
  /** The model named a product the brief does not: the plate is still
   *  looked at, but cannot be checked for it. */
  productUnchecked?: boolean;
  /** Where the brand is, for the scene (brandSetting). */
  setting?: string | null;
  /** The brief names a real person (briefNamesPeople). */
  namesPeople?: boolean;
}): Promise<CheckedPlate> {
  let imageCalls = 0;
  const objectFree = !product || isSceneKind(product.kind);
  const paint = async (prompt: string) => {
    imageCalls += 1;
    try {
      const plate = await adapter.generate({
        prompt,
        aspectRatio: spec.aspectRatio,
        negativePrompt: negativeFor(objectFree || namesPeople),
      });
      return drawablePlate(plate, adapter.id);
    } catch (err) {
      console.error("design plate generation failed, rendering flat", err);
      return null;
    }
  };
  /* An object-free scene is looked at for its subject box, writing and
     people only: no product is asked about. */
  const look = (bytes: Uint8Array) =>
    checkPlateShowsProduct({
      bytes,
      product: objectFree ? "" : (product?.name ?? ""),
      look: objectFree ? "" : (product?.look ?? ""),
      kind: "product",
    });
  const unverifiable = productUnchecked || !product;
  const passed: PlateCheck = objectFree
    ? "scene"
    : unverifiable
      ? "unchecked"
      : "passed";

  const first = await paint(
    platePrompt(spec, product, undefined, setting, namesPeople),
  );
  if (!first) {
    return {
      image: null,
      check: "unavailable",
      imageCalls,
      seen: [],
      look: null,
    };
  }
  const verdict = await look(first.bytes);
  if (!verdict) {
    return {
      image: first,
      check: "unchecked",
      imageCalls,
      seen: [],
      look: null,
    };
  }
  const firstRejection = rejection(verdict, product, namesPeople);
  if (!firstRejection) {
    return { image: first, check: passed, imageCalls, seen: [], look: verdict };
  }

  const noted = (v: PlateVerdict, r: Rejection) =>
    r.people
      ? `${v.seen} (a face)`
      : r.lettering
        ? `${v.seen} (lettered)`
        : v.seen;
  const seen = [noted(verdict, firstRejection)];
  const second = await paint(
    platePrompt(spec, product, firstRejection, setting, namesPeople),
  );
  if (!second) {
    return {
      image: null,
      check: failedAs(firstRejection),
      imageCalls,
      seen,
      look: null,
    };
  }
  const again = await look(second.bytes);
  if (!again) {
    return { image: second, check: "unchecked", imageCalls, seen, look: null };
  }
  const secondRejection = rejection(again, product, namesPeople);
  if (!secondRejection) {
    return {
      image: second,
      check: objectFree
        ? "scene"
        : unverifiable
          ? "unchecked"
          : "passed-on-retry",
      imageCalls,
      seen,
      look: again,
    };
  }
  seen.push(noted(again, secondRejection));
  console.error("plate rejected twice; rendering flat", {
    product: product?.name ?? null,
    seen,
  });
  return {
    image: null,
    check: failedAs(secondRejection),
    imageCalls,
    seen,
    look: null,
  };
}

/**
 * A checked plate, stored so the document references it by key and no later
 * edit pays for it again (spec, "Generation" 2). A plate that could not be
 * stored is not referenced: the direction is drawn flat.
 */
export async function paintPlate({
  brandId,
  ...painting
}: Parameters<typeof paintCheckedPlate>[0] & {
  brandId: string;
}): Promise<Omit<CheckedPlate, "image"> & { placed: PlacedAsset | null }> {
  const { image, ...outcome } = await paintCheckedPlate(painting);
  if (!image) return { ...outcome, placed: null };
  /* Named for what the bytes are. The plate models this project uses
     return PNG; a JPEG stored under .png would be served with the wrong
     type to the editor that reads it back. */
  const ext = image.contentType === "image/jpeg" ? "jpg" : "png";
  const key = `${STORAGE_PREFIXES.generated}/${brandId}/plates/${randomUUID()}.${ext}`;
  try {
    await uploadObject({
      key,
      body: image.bytes,
      contentType: image.contentType,
    });
  } catch (err) {
    console.error("design plate could not be stored, rendering flat", err);
    return { ...outcome, placed: null };
  }
  return { ...outcome, placed: { ref: { key }, asset: image } };
}

/**
 * Stores the mark exactly as the renderer draws it.
 *
 * The loader trims transparent padding and rasterises SVG, so the brand's
 * file under logos/ is not the bytes on the design. A document that named
 * the original would draw a smaller, padded or unrenderable mark the moment
 * the editor read it back. Keyed by content hash, so the same mark is one
 * object however many designs use it.
 */
export async function storeDrawnMark(
  brandId: string,
  logo: LoadedLogo,
): Promise<PlacedAsset | null> {
  const type = detectImageType(logo.bytes);
  if (type !== "png" && type !== "jpeg") return null;
  const { ext, contentType } = DRAWABLE[type];
  const hash = createHash("sha256").update(logo.bytes).digest("hex");
  const key = `${STORAGE_PREFIXES.generated}/${brandId}/marks/${hash.slice(0, 32)}.${ext}`;
  try {
    await uploadObject({ key, body: logo.bytes, contentType });
  } catch (err) {
    console.error("drawn logo could not be stored", err);
    return null;
  }
  return { ref: { key }, asset: { bytes: logo.bytes, contentType } };
}
