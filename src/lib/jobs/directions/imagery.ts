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
import { STORAGE_PREFIXES, uploadObject } from "@/lib/storage";

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
  | "unchecked";

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
  const scene = buildBackgroundPlatePrompt(spec);
  /* Round 2 painted a Lagos bakery's pastry on a European street and wrote
     "MIOCZEBC PRALEF" on a zobo bottle. */
  const place = setting
    ? `Set in ${setting}: its own streets, interiors, people and light`
    : null;
  /* Round-5 eval: phones, laptops and gym walls came back lettered twice
     and five directions were drawn as text; screens and signs are where
     the image model paints writing. */
  const plain =
    "Any packaging, bottle, box or bag is plain and unbranded, with no label text, printed words, letters or logos. No phone or laptop screens facing the viewer, no signs, posters or printed clothing";
  /* A painted face beside a named speaker reads as that person (round-3
     live critic: the eval painted a woman for "Ada Obi"). */
  const people = namesPeople
    ? "No people, faces or hands: the brief names real people, and a painted stranger would stand in for them"
    : "Any person is an anonymous passer-by, never posed as a named host, speaker or customer";
  const tail = [scene, place, plain, people].filter(Boolean).join(". ");
  if (!product) {
    if (setting && !rejected?.lettering) return `In ${setting}: ${tail}`;
    return rejected?.lettering
      ? `Nothing in the image carries any writing; the last attempt painted lettering, which is wrong. ${tail}`
      : tail;
  }
  /* Said up front as well: at the end of a long prompt the setting lost to
     the model's default street (round-3 live run, again European). */
  const where = setting ? `, in ${setting}` : "";
  const asScene = product.kind === "event" || product.kind === "service";
  if (!rejected) {
    return asScene
      ? `A scene from the ${product.name}${where}, recognisable as that ${product.kind}. ${tail}`
      : `A ${product.name}, clearly recognisable, as the subject${where}. ${tail}`;
  }
  const wrong = rejected.people
    ? "the last attempt painted a person's face, which is wrong: no faces anywhere"
    : rejected.lettering
      ? "the last attempt painted lettering on it, which is wrong: no writing anywhere"
      : `the last attempt showed ${rejected.seen || "something else"} instead, which is wrong`;
  return asScene
    ? `${product.look || product.name}. A scene that plainly belongs to the ${product.name}${where}; ${wrong}. ${tail}`
    : `${product.look || product.name}. The ${product.name} is the clear subject${where}, whole and unmistakable; ${wrong}. ${tail}`;
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

function drawable(
  plate: { bytes: Uint8Array; contentType: string },
  adapterId: string,
): { bytes: Uint8Array; contentType: string } | null {
  const type = detectImageType(plate.bytes);
  if (type !== "png" && type !== "jpeg") {
    console.error(
      `plate from ${adapterId} came back as ${type ?? plate.contentType}; rendering flat`,
    );
    return null;
  }
  return { bytes: plate.bytes, contentType: DRAWABLE[type].contentType };
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
  if (product && !verdict.shows) return { seen: verdict.seen };
  if (verdict.lettering) return { lettering: true };
  if (namesPeople && verdict.person) return { people: true };
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
  const paint = async (prompt: string) => {
    imageCalls += 1;
    try {
      const plate = await adapter.generate({
        prompt,
        aspectRatio: spec.aspectRatio,
      });
      return drawable(plate, adapter.id);
    } catch (err) {
      console.error("design plate generation failed, rendering flat", err);
      return null;
    }
  };
  const look = (bytes: Uint8Array) =>
    checkPlateShowsProduct({
      bytes,
      product: product?.name ?? "",
      look: product?.look ?? "",
      kind: product?.kind ?? "product",
    });
  const unverifiable = productUnchecked || !product;
  const passed = unverifiable ? "unchecked" : "passed";

  const first = await paint(
    platePrompt(spec, product, undefined, setting, namesPeople),
  );
  if (!first) {
    return {
      image: null,
      check: "unchecked",
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
      check: unverifiable ? "unchecked" : "passed-on-retry",
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
