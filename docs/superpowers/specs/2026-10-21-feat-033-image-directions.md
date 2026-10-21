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
| 2 | Editor: canvas select/drag/resize/rotate/snap, Design and Layers panels, undo/redo, versions (save, restore, up to 30), format switch. Text fit while editing is a browser estimate (font-metric advance widths read from the same TTFs satori loads, with 1em assumed for any glyph the font lacks, so emoji and CJK estimate wide, never narrow). The server re-fits with the satori measurer on save, and the saved document is the server's. Decided with Oluwaseyi 2026-10-21: the server measurer costs 0.4-1.3 s per probe set, too slow for every keystroke. |
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
- **Decoded once.** `storageKeyFrom` refuses a decoded key that a second read would change: a leftover `%` (double encoding), `?`, `#`, `\`, an empty segment, control or invisible characters, or a malformed escape. Legacy keys outside the canonical alphabet still resolve.
- **Canonical keys.** A key must also be in the shape the app mints (`isCanonicalKey` in `src/lib/storage-keys.ts`): letters, digits, `.`, `_` and `-` in non-empty `/`-separated segments, no dot segments. A stored key never passes through a URL decoder, so `%2e%2e`, `//host`, `?`, `#` and invisible characters are refused outright rather than decoded.
- **Pinned canvas.** `width` and `height` must be one of the `canvasFor` sizes. Element geometry is bounded to two canvases in any direction and type to a third of the longest edge, so no document can ask satori for a 10000 px raster.

### `src/lib/design/document/render.tsx`

`documentElement(doc, assets: Record<key, dataUri|url>, fonts) → ReactElement`.

- Only CSS satori supports: `position:absolute`, `display:flex`, `transform: rotate()`, `opacity`, `borderRadius`, `objectFit`, `backgroundImage: linear-gradient`.
- No browser-only properties.
- Greedy line wrapping only, with `word-break: break-word`. `text-wrap: balance` breaks lines differently in satori and Chromium, so balancing is done by the builder (it narrows the box), the one rule both engines agree on.
- `break-word` only on a line at least `minBreakableWidth` wide (three ems plus tracking). Satori never returns when it has to break a line narrower than one glyph, so a box an edit drags narrower than a letter overflows instead of hanging the renderer.
- The same function runs in the editor. `browser-parity.smoke.test.ts` draws every builder output in Chromium and in satori and holds both inside every box.

`rasterizeDocument({ doc, assets, brand, logoInk?, fonts? }) → { bytes, document, logoFault, brandFontFault }` goes through `createBrandRasterizer` and `logoBackingOnGround` in `render/rasterize.ts`, the same two functions the flex composite uses. One brand-font fallback and one logo-backing measurement, shared.

### `src/lib/design/document/from-spec.ts`

`documentFromSpec({ spec, palette, canvas, image: AssetRef|null, imageFacts?, logo, measurer }) → { document, copyFault }`.

- **One builder per existing layout**, one file each under `document/builders/`: `hero-center`, `split-left`, `banner-bottom`, `quote-card` and `stat-highlight`, over shared geometry, copy stack and footer.
- **Explicit geometry:** each builder computes boxes for the same zones the flex layout produces today, from canvas width and height, with the flex layouts' own `HEADLINE_STEPS`, `BANNER_BAND` and `footerBandHeight`.
- **Text that fits:** sizes are fitted by laying the copy out through satori itself (`measure.tsx`), so it is exact for the PNG. Every run is measured 2% narrower than it is drawn, which is the room Chromium needs. It needs `next/og`, so it runs on the server; the editor's in-browser estimate and the re-fit on save are PR 2 (table above).
- **Copy faults, never silent:** below the type scale, copy shrinks toward a legibility floor (1.9% of the short side); below the floor a word breaks instead. Either is reported in `copyFault` (`COPY_SHRUNK`, `COPY_WORD_BROKEN`, or `COPY_TOO_LONG` when even that overflows), for the job to surface as a quality fault.
- **Card layouts hold the image inside the card**, clipped to its rounded corners, on a flat ground. A cut-out sits whole in the top of the card with the copy below it, stepping its share of the canvas down (42%, 36%, 30%) before it would ever be laid under the copy; a photograph fills the card with the copy anchored low over its measured veil.
- **The footer never repeats the CTA.** `footerLinesFor` (render/footer.ts, shared with the flex renderer and the judge) drops any footer item that is the CTA, part of it, or contains it, and keeps what follows a CTA used as a label ("Order on WhatsApp: 0803..." keeps the number).
- **Images, measured:** `imageFacts` comes from `measureImage(bytes)` (`document/image-facts.ts`). A cut-out (transparent PNG) is contained and sized by its visible pixels, never cropped. Copy over a photograph gets the least veil at which every pixel behind it clears 4.5:1: dark type and no veil on a bright photo, white type and no veil on a dark one. Without facts, the photo is treated as the worst case.

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
- **Checking the real file at generation:** the server sniffs the bytes (`detectImageType`), refuses files over 4096 px on either side, and proves the image decodes (PNG: the IDAT stream inflates to the size the header promises; JPEG: a frame header, a scan and an end marker are present). A file that fails any check is a `DesignImageError`, so a corrupt upload is an error the user can act on, never a design with a silently empty image slot.
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
    - `loadDesignImage(key, brandId)`: returns `{ bytes, contentType, width, height }`, or throws `DesignImageError` with a user-facing message.
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
