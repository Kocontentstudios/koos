import type { ImageFacts } from "@/lib/design/document/builders/ground";
import {
  HEADS_UNKNOWN,
  headsForLayout,
  headsWithMargin,
  type NoCropReason,
  type SubjectBox,
  subjectFromAlpha,
} from "@/lib/design/document/subject";
import type { PhotoLook } from "@/lib/design/quality/plate-check";
import { cleanCutoutBytes } from "@/lib/images/cutout-edge";
import type { PlacedAsset } from "./directions/imagery";

/** What every layout of the client's own photo has to respect. */
export interface UploadedPhotoSubject {
  /** Heads as the look boxed them, before the margin. */
  photoHeadsSeen: SubjectBox[];
  /** The same heads grown by the head margin. */
  photoHeads: SubjectBox[];
  /** The heads every layout keeps whole (headsForLayout). */
  layoutHeads: readonly SubjectBox[];
  noCropReason: NoCropReason | null;
  /** People in the photo and no head boxed, even when asked again. */
  headsUnknown: boolean;
  /** The whole subject first, then a person's head and shoulders. */
  boxes: (SubjectBox | null)[];
}

/**
 * Reads the client's photo for layout, shared by the directions and the
 * sequence jobs so both treat one upload the same way. A cut-out's asset is
 * replaced in place by its cleaned bytes.
 */
export async function readUploadedPhoto(
  photo: PlacedAsset,
  measured: ImageFacts | null,
  look: PhotoLook | null,
): Promise<UploadedPhotoSubject> {
  /* The client's photo's people. The look's boxes are grown by the head
     margin (round-26 contract break: a box drawn short of the barista's
     face let a crop through it), and since the look also misplaces and
     misses heads, a photo with people in it is never cropped at all. */
  let photoHeadsSeen: SubjectBox[] = [];
  let photoHeads: SubjectBox[] = [];
  /* People in the photo and no head boxed, even when asked again, is not
     "no heads" (round-10 live verdict, CB2: the cafe crop sliced the
     barista's face). Every crop and band is then refused, the photo drawn
     whole or left off, and the direction carries a fault. */
  let headsUnknown = false;
  /* What every layout of the client's photo sees as its heads, and why it
     may not be cropped (headsForLayout: people in the photo are never
     cropped, Oluwaseyi's ruling of 2026-10-29). */
  let layoutHeads: readonly SubjectBox[] = [];
  let noCropReason: NoCropReason | null = null;
  if (!measured?.cutout) {
    photoHeadsSeen = look?.heads ?? [];
    photoHeads = headsWithMargin(photoHeadsSeen);
    const decided = headsForLayout(Boolean(look?.peopleVisible), photoHeads);
    layoutHeads = decided.heads;
    noCropReason = decided.noCrop;
    headsUnknown = noCropReason === "headsUnknown";
  }
  /* A cut-out's subject is its visible pixels, which are exact; the look
     is only for a photograph, where the whole subject comes first and a
     person's head and shoulders second. With people in an uncropped
     photo and no subject boxed, the subject is the whole photo. */
  const boxes = measured?.cutout
    ? [subjectFromAlpha(measured)]
    : [
        look?.subject ?? (noCropReason ? HEADS_UNKNOWN[0] : null),
        look?.face ?? null,
      ];
  /* Drawn on a coloured ground, a cut-out's baked shadow and white fringe
     show; its edge is feathered and decontaminated first (cutout-edge). */
  if (measured?.cutout) {
    photo.asset = {
      ...photo.asset,
      bytes: await cleanCutoutBytes(photo.asset.bytes),
      contentType: "image/png",
    };
  }
  return {
    photoHeadsSeen,
    photoHeads,
    layoutHeads,
    noCropReason,
    headsUnknown,
    boxes,
  };
}
