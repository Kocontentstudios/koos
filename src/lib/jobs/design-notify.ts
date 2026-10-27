import { createNotification } from "@/lib/db/queries";
import { LOGO_FILE_FAULTS } from "@/lib/design/render/logo";

/* A design that rendered without the brand's own typeface or without its logo
   still looks finished, so nothing about the result itself tells the user what
   was dropped — they would just keep wondering why their brand never appears.

   The bell rather than the design row: the fault belongs to the brand asset,
   not to this one design, and it recurs on every future generation until the
   file is replaced. Deliberately not a failure — the design succeeded.

   One notification per fault kind per generation, not one per variant: every
   variant loads the same brand assets and would report the same fault. */
async function notifyAssetFault(userId: string, message: string) {
  await createNotification({
    userId,
    type: "system",
    payload: { message },
  }).catch((err) => {
    // A design that rendered must not be lost to a notification write.
    console.error("brand asset notification failed", err);
  });
}

/* Reasons that name the brand's own upload. Anything else is ours or the
   model's, and must not send the user to replace a file that is fine. */
const BRAND_FILE_FAULTS: ReadonlySet<string> = new Set(LOGO_FILE_FAULTS);

export async function notifyLogoLeftOff({
  userId,
  reason,
}: {
  userId: string;
  reason: string;
}) {
  await notifyAssetFault(
    userId,
    `This design was made without your brand logo, because ${reason}. Generate it again without that instruction if the logo should be on it.`,
  );
}

/* Not a brand-asset fault, but the same bell: the design succeeded, and
   nothing on it says the imagery the user asked for is missing. */
export async function notifyImageLeftOff({
  userId,
  directions,
  of,
  subject,
  cause = "rejected",
}: {
  userId: string;
  directions: number;
  of: number;
  subject: string;
  /** "unavailable": the image model returned nothing usable, so no plate
   *  was judged. "rejected": plates were painted and turned down.
   *  "photo": the client's photo fits only the layout its sibling shows it
   *  in, so this direction is laid out as text (round 8). */
  cause?: "rejected" | "unavailable" | "photo";
}) {
  const which =
    of === 1
      ? "This direction was"
      : directions === of
        ? "Both directions were"
        : "One direction was";
  if (cause === "photo") {
    await notifyAssetFault(
      userId,
      `${which} laid out with words only: your photo fits only the layout the other direction shows it in. Regenerate it for another layout, or upload a photo with more room around the subject.`,
    );
    return;
  }
  const why =
    cause === "unavailable"
      ? "KO's image service didn't return an image just now, so none could be used"
      : `the images KO made${subject ? ` of the ${subject}` : ""} couldn't be used: they showed the wrong thing, painted made-up writing or a face, or left no room to show the subject whole`;
  await notifyAssetFault(
    userId,
    `${which} laid out with words only: ${why}. Regenerate it to try new imagery, or upload your own photo.`,
  );
}

export async function notifyBrandAssetFaults(
  userId: string,
  faults: { font: string[]; logo: string[] },
) {
  const font = faults.font[0];
  if (font) {
    await notifyAssetFault(
      userId,
      /* Names the page, because until KOS-V1-FEAT-022 the only font upload
         was inside conversational onboarding and this sentence pointed at a
         control the user could not reach. */
      `Your brand font couldn't be used, so this design was set in the default typefaces instead: ${font}. Upload a replacement under Brand Fonts in Edit Brand.`,
    );
  }

  /* Distinct reasons, not the first one. A load fault and a per-variant stamp
     failure are different problems with different remedies, and reporting only
     whichever happened to land first tells the user to fix the wrong thing.
     Deduped because every variant loads the same file. */
  const reasons = [...new Set(faults.logo)];
  if (reasons.length > 0) {
    /* "Upload a replacement" only when the brand's file is actually the
       problem. A model that returned an image satori choked on is not
       something the user fixes by re-uploading a logo that is fine, and
       telling them so sends them round a loop that cannot end. */
    const theirFileIsAtFault = faults.logo.some((reason) =>
      BRAND_FILE_FAULTS.has(reason),
    );
    await notifyAssetFault(
      userId,
      `Your brand logo couldn't be added to this design because ${reasons.join("; and ")}.${
        theirFileIsAtFault
          ? " Upload a replacement under Logo in Edit Brand."
          : " Generating the design again usually clears it."
      }`,
    );
  }
}
