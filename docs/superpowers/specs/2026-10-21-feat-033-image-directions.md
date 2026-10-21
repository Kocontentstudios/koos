# KOOS-V1-FEAT-033: image upload, two directions, editable designs

**Ticket:** [KOOS-V1-FEAT-033](https://app.clickup.com/t/123qy9rtnj2) (urgent)
**Design references:** Figma `KO-OS-Upload-Picture---Edit-with-AI` node 14-1643; the ticket's HTML prototype (a front-end mock, every AI action faked locally).
**Decided with Oluwaseyi, 2026-10-21:**

1. **Editor:** a free-form layer editor, built in phases.
2. **Directions:** two different concepts, not one concept drawn twice.
3. **Edit with AI:** uses the app's existing model, `getModel("strategy")`.
4. **Old variants:** at the Calendar and Design Studio entry points, the two editable directions replace the 1-3 route variants. Model-drawn variants are no longer produced there.

## Why a new design model

Today one generation produces one `DesignSpec`, the short structured description of a design (`src/lib/design/spec.ts`). It is rendered by five fixed flexbox layouts (`render/layouts.tsx`) through satori. Elements have no positions, so nothing can be dragged, resized or rotated. On top of that, the background plate is never stored, so changing one word costs a new image-model call.

The fix is a **layer document**: an absolutely positioned list of elements.

- Generation builds it from the spec.
- The editor (phase 2) mutates it.
- One renderer draws it in both places:
  - **On the server:** satori turns it into PNG.
  - **In the browser:** the same JSX renders as DOM.

Satori renders a subset of HTML/CSS. Restricting the renderer to that subset makes the editor and the export agree by construction. A canvas library (Konva, Fabric) would need a second renderer and a parity test it could never fully pass. That is why the editor is DOM + `react-moveable` and not `react-konva`.

## Phases

| PR | Scope |
|---|---|
| **1 (this spec)** | Image choice (own image or KO imagery), upload with preview/remove/replace, two directions as layer documents with a "why this works" list, results screen, PNG and JPG download, regenerate. Calendar post and Design Studio entry points. |
| 2 | Editor: canvas select/drag/resize/rotate/snap, Design and Layers panels, undo/redo, versions (save, restore, up to 30), format switch. |
| 3 | Edit with AI: free-text and chips, scope (whole design or selection), proposal preview with changed elements outlined, brand checks, accept/decline/try again, accept saves a version. |

## PR 1 contracts

### `src/lib/design/document/schema.ts`: `designDocumentSchema` (zod), version 1

```
{
  version: 1,
  width, height,              // canvas px, from canvasFor(aspectRatio)
  background: string,         // CSS colour
  elements: Element[]         // array order is z-order, first is bottom
}
Element (shared):
  id, name, x, y, width, height, rotation (deg), opacity (0..1), hidden, locked
  type "image":  asset: AssetRef, fit "cover"|"contain", crop {zoom>=1, focusX 0..1, focusY 0..1}, radius
  type "shape":  fill (colour or linear-gradient), borderColor, borderWidth, radius
  type "text":   text, role "headline"|"subheadline"|"cta"|"footer"|"body",
                 font "heading"|"body", fontSize, fontWeight, lineHeight, letterSpacing,
                 align "left"|"center"|"right", italic, color
  type "button": label, fill, color, radius, fontSize, fontWeight
  type "logo":   asset: AssetRef, backing: colour|null
AssetRef = { key: string }    // an R2 storage key, never a URL
```

- **Keys, not URLs.** An asset is referenced by storage key. The server resolves keys to bytes for satori, and the client resolves them to signed URLs.
- **Pinned prefixes.** Keys are accepted only under `logos/`, `generated/` and the new `design-images/` prefix. This is the same pinning `storageKeyFrom` already enforces, so a document can never point the renderer at an arbitrary host.

### `src/lib/design/document/render.tsx`

`documentElement(doc, assets: Record<key, dataUri|url>, fonts) → ReactElement`.

- Only CSS satori supports: `position:absolute`, `display:flex`, `transform: rotate()`, `opacity`, `borderRadius`, `objectFit`, `backgroundImage: linear-gradient`.
- No browser-only properties.
- The same function runs in the editor.

`rasterizeDocument(doc, assets, brandFonts) → PNG bytes` reuses the composite rasterize path. That covers its brand-font fallback and its logo-backing measurement.

### `src/lib/design/document/from-spec.ts`

`documentFromSpec({ spec, palette, canvas, image: AssetRef|null, logo }) → DesignDocument`.

- **One builder per existing layout:** `hero-center`, `split-left`, `banner-bottom`, `quote-card` and `stat-highlight`.
- **Explicit geometry:** each builder computes boxes for the same zones the flex layout produces today, from canvas width and height.
- **Text that fits:** headline size is fitted to its box from the text length and the measured advance widths of the font in use. The fit check is a deterministic function with tests. It is not a guess.

### Generation (`src/lib/jobs/run-design-generation.ts`)

New request field `image: { source: "upload", key } | { source: "ko" }`. Its presence selects the directions path. Without it, generation keeps today's behaviour, so other callers are unchanged.

1. **Two specs from one model call.** One `generateObject` returns `{ directions: [DirectionSpec, DirectionSpec] }`. A `DirectionSpec` is a `DesignSpec` plus `rationale: string[]` (2 to 4 short reasons, shown as "why this works").
   - The two must differ in layout. Code enforces it: when the model repeats a layout, the second direction gets the first layout not used by the first direction and not in recent layout memory.
2. **Imagery.**
   - `upload`: the user's image is that direction's image element. No image-model call is made.
   - `ko`: one plate per direction from `getPlateAdapter()`, stored at `generated/{brandId}/plates/{uuid}.png` and referenced from the document, so later edits never pay for it again.
   - A failed plate still yields a design on a flat brand colour, as today.
3. Each direction runs through the existing pre-delivery gate (`renderGuarded` semantics: deterministic checks, one judge correction).
4. Each direction is one `design_generations` row, `renderer = composite`, holding the document and rationale. The job result lists both ids.
5. Quota: one generation is one quota unit, as today.
6. **Regenerating one direction.** Request field `regenerateOf: generationId` (requires `image`). The job produces exactly one direction, whose layout differs from that generation's layout and from its sibling's. On the KO path that is one plate call, not two. One quota unit. The new row records the same job-level `image_source`. The UI swaps it into that slot; nothing is discarded, so Design Studio history gains no orphan row.
7. **Progress.** The directions path reports `JobProgress` with a `stage` field the UI maps to its four steps: `brief` (writing the two directions), `imagery` (plates, KO path only), `render` (`done`/`total` count rendered directions) and `checks` (the pre-delivery gate). `label` stays human text. The UI keys off `stage`, never off `label`.

### Upload

- **Endpoint:** `POST /api/uploads/presign` with `kind: "design-image"`.
- **Presign accepts PNG and JPEG only**, up to 20 MB, stored under `design-images/{brandId}/{uuid}.{png|jpg}`. WEBP never reaches presign: the browser converts it first.
- **The signature binds the type and the size.** The AWS presigner leaves `content-type` unsigned by default, so the URL signs `content-type` and `content-length` explicitly (`signableHeaders`). Without that, one URL accepts any type up to R2's 5 GB, and the bucket's public domain would serve it. The same signing function serves attachments and documents, so they get the fix too.
  - **What the browser must send:** presign returns the `contentType` it signed. The PUT sends exactly that `Content-Type` and exactly `sizeBytes` bytes (for a design image, `sizeBytes` is the normalised `blob.size`), or R2 answers 403. `uploadToPresignedUrl(url, blob, onProgress, contentType)` in `src/lib/uploads/put-presigned.ts` does this.
  - An untyped `.txt` document (the browser sends an empty type) is signed as `text/plain`, because an empty type cannot be bound.
- **The key is built from the brand row** (`access.brand.id`), never from the request string, so an uppercase UUID that Postgres matches cannot reach `designImageKeyFor` and 500.
- **Normalised in the browser:** before upload the browser re-encodes every image to fit within 2560 px on the long edge.
  - An image with any transparent pixel (PNG or WEBP) becomes PNG, so the transparency survives. Every opaque image becomes JPEG, which is far smaller for photos.
  - **Why:** satori cannot draw WEBP (see `run-design-generation.ts` on "u2 is not iterable"), and phone photos arrive at 7000+ px, which resvg rasterises slowly and with a large memory cost inside a lambda.
  - **Free fixes:** re-encoding through `createImageBitmap` also applies EXIF orientation, and strips EXIF metadata such as location. A browser that rejects the `imageOrientation` option with a `TypeError` is retried without it.
  - **Too many pixels:** a file whose header declares more than 100 megapixels (a decompression bomb, or a photo no phone browser can hold decoded) is refused before decoding as too large, not as damaged.
- **Checking the real file at generation:** the renderer never sees the stored bytes. `loadDesignImage` returns bytes it encoded itself, or a `DesignImageError`.
  - **Why:** resvg (inside `next/og`) is not safe to hand an uploaded file. An indexed PNG whose PLTE length is not a multiple of 3 panics it, and the panic aborts the Node process (SIGABRT, exit 134), which no try/catch contains. Dozens of other well-framed PNGs and JPEGs it draws as nothing, or throws a `TypeError` on. A structural check cannot copy its decoder rule for rule (FEAT-033 upload round-2 critic).
  - **Cheap checks first:** the key, the 20 MB cap, the type sniff (`detectImageType`, PNG or JPEG only, matching the key), the 4096 px cap per side, then the structural pre-filter (`src/lib/images/decode-check.ts`: the IDAT stream inflates to exactly what the header promises; the JPEG has a frame, a scan and an end marker). The pre-filter refuses truncated uploads and decompression bombs before any decoder allocates for them.
  - **The re-encode:** `reencodeImage` (`src/lib/images/reencode.ts`) decodes with sharp 0.35.5 (libvips, libpng, libjpeg-turbo) with `failOn: "warning"` and a 4096 x 4096 pixel limit, and writes a fresh file: PNG stays PNG (alpha kept), JPEG stays JPEG (quality 92, 4:4:4, baseline). Every output is 8-bit sRGB with no metadata: 16-bit becomes 8-bit, CMYK and ICC-tagged files are converted to sRGB, and EXIF orientation is applied, so the server shows what the browser showed. `width` and `height` are the output's. sharp never sees an SVG: only bytes that sniff and decode as PNG or JPEG reach it.
  - **Blank images:** a PNG with no pixel above alpha 0 draws exactly like no image, so it is refused (`blank`).
  - **The guarantee:** every file the loader accepts is drawn by the real `next/og`, and none aborts or throws in it. Every file it refuses carries `IMAGE_NOT_USABLE_PREFIX`. Any decoder failure is `unreadable`.
  - **The gate:** `design-image.render-gate.smoke.test.ts` builds the critic's corpus in memory (`src/lib/images/hostile-image-fixtures.ts`, 169 files: valid libvips encodes, truncations, chunk-level and marker-level mutations, the PLTE-length cases). It runs each through the loader and draws everything accepted in a child process (`render-in-child.ts`), asserting exit 0, no throw, and a render that differs from the no-image render. With the re-encode removed, the same test fails on `c-plte_len_not_mult3.png` with SIGABRT.
  - **Brand logos** get the same re-encode before `probeLogo` (`loadBrandLogo`), with an 8192 x 8192 input limit and output scaled to fit 4096 px. An 8-bit sRGB PNG logo draws pixel for pixel the same (`logo-reencode.smoke.test.ts`). SVG logos are rasterised by resvg as before and are not covered.
  - **Cost** (`corepack pnpm bench:reencode`, median of 7): 2560 x 1707 JPEG, 132 ms. 4096 x 4096 opaque PNG, 63 ms. 4096 x 4096 PNG with alpha, 570 ms (it decodes to raw once to check for visible pixels).
- **Error contract:** every user-facing unusable-image message starts with `IMAGE_NOT_USABLE_PREFIX` ("This image can't be used"), exported from `src/lib/uploads/design-image-limits.ts`, which has no server imports. The UI detects the state by that constant, not by its own copy of the wording.

### Schema (migration `0037_design_documents.sql`)

`design_generations` gets four new nullable columns: `document` (jsonb), `rationale` (jsonb), `image_source` (text: `upload` or `ko`) and `source_image_key` (text). Old rows keep `document = null` and render exactly as today.

### Client/server contract

These are the seams the parallel units build against.

- **`DirectionSpec`** is a `DesignSpec` plus:
  - `title`: up to 40 characters, e.g. "Playful product story"
  - `rationale`: 2 to 4 strings, each up to 90 characters

  Both are stored in `design_generations.rationale` as `{ title, reasons }`.
- **`SerializedGeneration`** (`src/lib/design/serialize.ts`) gains:
  - `direction: { title: string; reasons: string[] } | null`
  - `imageSource: "upload" | "ko" | null`
  - `editable: boolean` (`document !== null`)
- **`GenerateArgs`** (`src/components/design/use-design-generation.ts`) gains `image?: { source: "upload"; key: string } | { source: "ko" }` and `regenerateOf?: string` (a generation id; requires `image`). The route validates both, checks `regenerateOf` belongs to the same brand, and passes them through to the job.
- **`JobProgress`** (`src/lib/generation/poll-job.ts`) gains `stage?: "brief" | "imagery" | "render" | "checks"`.
- **Upload helpers:**
  - `src/lib/uploads/normalize-image.ts` (browser): `normalizeImageForUpload(file: File): Promise<{ blob: Blob; type: "image/png" | "image/jpeg"; width: number; height: number }>`. It throws `ImageNotUsableError` with a user-facing message.
  - `src/lib/uploads/design-image.ts` (server):
    - `designImageKeyFor(brandId, ext)`
    - `isDesignImageKeyFor(key, brandId)`
    - `loadDesignImage(key, brandId)`: returns `{ bytes, contentType, width, height }`, or throws `DesignImageError` with a user-facing message. `bytes` is the server's re-encode, never the stored file, and `width` and `height` are its size after EXIF orientation. Faults: `foreign_key`, `missing`, `too_large`, `not_png_or_jpeg`, `type_mismatch`, `unreadable`, `too_many_pixels`, `blank`.
- **Presign:** `POST /api/uploads/presign` with `kind: "design-image"` returns `{ url, key, contentType }`, the same shape as the other kinds.

### UI

- **Entry points:** every user of the shared `GenerateDesignButton` (calendar item drawer, strategy design brief panel) plus the Design Studio generate action. The flow lives behind `GenerateDesignButton`, so no entry point can skip the image choice.
- **Send to design team** stays: each direction card carries it, keyed per row, with the ticket context the calendar drawer passes today.
- **Legacy rows** (no `direction`) keep opening the existing `DesignPreviewModal`.
- **Flow:** both open the image-choice modal: "Use a specific image" or "Let KO create the imagery".
  - **Upload:** drop zone with click-to-browse, type and size validation, preview with Remove / Replace / Use this image.
  - **Progress:** a four-step progress modal driven by the job's real progress events, with an error state.
  - **Results:** two direction cards, each with the image, "why this works", Download PNG, Download JPG, Send to design team and Regenerate (this direction only, via `regenerateOf`). Editing is phase 2, so the card has no Edit control yet. A placeholder for an unbuilt feature is a lie.
- **JPG:** converted in the browser from the stored PNG on a `canvas`, white-filled first because JPEG has no alpha.
- Every wait follows CLAUDE.md "Every wait gets an affordance".

### Measurable outcome

- **Events:**
  - `design_image_choice` with `{source}`
  - `design_directions_generated` with `{source, directions, quality_faults}`
  - `design_downloaded` with `{format}`
- **Funnel:** image choice → directions delivered → download.
- **Cost:** with `source = upload`, image-model calls per generation drop from 1-3 to 0, visible on the usage row's `renderers` metadata.

## Out of scope for PR 1

The editor, versions, Edit with AI, background removal, format switching after generation, and multi-page output (KOOS-AI-002).
