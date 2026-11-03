import { getAuthUser } from "@/lib/auth/get-user";
import { checkBrandAccess, listSetFrames } from "@/lib/db/queries";
import { multiFrameEnabled } from "@/lib/design/multi-frame-flag";
import {
  frameFileName,
  isSetDownloadFormat,
  pdfFrames,
  pngSize,
  SET_DOWNLOAD_CONTENT_TYPES,
  setDownloadKey,
  setFileName,
  zipFrames,
} from "@/lib/design/sequence/download";
import { liveFrames, serializedFrameOf } from "@/lib/design/sequence/frames";
import {
  getObjectBytes,
  getSignedReadUrl,
  STORAGE_PREFIXES,
  uploadObject,
} from "@/lib/storage";
import { isUuid } from "@/lib/validation/uuid";

/* Measured: twelve incompressible 1920x1080 frames take about 6s to turn
   into a PDF, because pdf-lib decodes and re-encodes every PNG. A minute is
   that plus the R2 round trips with room to spare. */
export const maxDuration = 60;

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

/**
 * Save a carousel or presentation as one file: the frames on show, never a
 * frame a regenerate replaced.
 *
 * The file is built here, written to R2, and the browser is redirected to a
 * short-lived signed URL, like the single design download. Returning the
 * bytes from the function instead fails on Vercel, which refuses any
 * response body over 4.5 MB, and five full-size frames are already past it.
 * The key is derived from the live frames, so downloading the same set again
 * overwrites one object rather than adding another.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ setId: string }> },
) {
  const { dbUser } = await getAuthUser();
  if (!dbUser) {
    return Response.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!multiFrameEnabled()) return notFound();

  const { setId } = await params;
  if (!isUuid(setId)) return notFound();

  const url = new URL(req.url);
  const brandId = url.searchParams.get("brandId");
  if (!isUuid(brandId)) {
    return Response.json(
      { error: "Missing or invalid brandId" },
      { status: 400 },
    );
  }
  const format = url.searchParams.get("format");
  if (!isSetDownloadFormat(format)) {
    return Response.json(
      { error: "format must be zip or pdf" },
      { status: 400 },
    );
  }

  /* Every refusal reads the same as a set that does not exist, so a setId
     from another workspace cannot be probed for (the single download's
     rule). listSetFrames filters by brand too, so a set id paired with a
     brand the caller can reach still finds nothing of another brand's. */
  const access = await checkBrandAccess(dbUser.id, brandId, "manage_content");
  if (!access.ok) return notFound();

  /* A frame still rendering, or one whose render failed with no earlier
     take to fall back on, has no bytes; the file carries the rest. */
  const deliverable = liveFrames(await listSetFrames(brandId, setId)).flatMap(
    (row) => {
      const frame = serializedFrameOf(row);
      return row.status === "succeeded" && row.imageKey && frame
        ? [{ row, frame, imageKey: row.imageKey }]
        : [];
    },
  );
  if (deliverable.length === 0) {
    return Response.json(
      { error: "This set has no finished frames to download yet." },
      { status: 404 },
    );
  }

  /* The key is written by the job, not the user, but a stored key is never
     handed to the storage client unchecked (the single download's rule). */
  const stray = deliverable.find(
    ({ imageKey }) => !imageKey.startsWith(`${STORAGE_PREFIXES.generated}/`),
  );
  if (stray) {
    console.error(
      `design ${stray.row.id} has an imageKey outside the generated prefix`,
    );
    return notFound();
  }

  const first = deliverable[0].row;
  const fileName = setFileName(
    {
      setId,
      brandName: access.brand.name,
      designType: first.designType,
      width: first.width,
      height: first.height,
    },
    format,
  );
  const key = setDownloadKey({
    brandId,
    setId,
    frameIds: deliverable.map(({ row }) => row.id),
    format,
  });

  const started = Date.now();
  try {
    const images = await Promise.all(
      deliverable.map(({ imageKey }) => getObjectBytes(imageKey)),
    );
    /* Sized to the largest index as well as the stored count, so a row
       whose count disagrees with its index still gets a name. */
    const setCount = Math.max(
      ...deliverable.map(({ frame }) => Math.max(frame.count, frame.index + 1)),
    );
    const body =
      format === "zip"
        ? zipFrames(
            deliverable.map(({ frame }, i) => ({
              name: frameFileName(frame.index, frame.role, setCount),
              bytes: images[i],
            })),
          )
        : await pdfFrames(
            images.map((bytes) => ({ bytes, ...pngSize(bytes) })),
          );
    await uploadObject({
      key,
      body,
      contentType: SET_DOWNLOAD_CONTENT_TYPES[format],
      contentDisposition: `attachment; filename="${fileName}"`,
    });
    const signed = await getSignedReadUrl(key, 300, {
      disposition: "attachment",
      fileName,
    });
    console.log(
      `design.sequence.download ${JSON.stringify({
        setId,
        format,
        frames: deliverable.length,
        bytes: body.byteLength,
        ms: Date.now() - started,
      })}`,
    );
    return Response.redirect(signed, 302);
  } catch (err) {
    console.error(`design set ${setId} download failed`, err);
    return Response.json(
      { error: "Could not build the download. Try again." },
      { status: 502 },
    );
  }
}
