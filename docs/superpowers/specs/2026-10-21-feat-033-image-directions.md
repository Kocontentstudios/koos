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
  - **Why:** satori cannot draw WEBP (see `run-design-generation.ts` on "u2 is not iterable"), and phone photos arrive at 7000+ px while the server fits every image to 2560 px anyway, so a bigger upload is bytes nobody draws.
  - **Free fixes:** re-encoding through `createImageBitmap` also applies EXIF orientation, and strips EXIF metadata such as location. A browser that rejects the `imageOrientation` option with a `TypeError` is retried without it.
  - **Too many pixels:** a file whose header declares more than 100 megapixels (a decompression bomb, or a photo no phone browser can hold decoded) is refused before decoding as too large, not as damaged.
  - **Fully transparent:** an image with no pixel above alpha 0 is refused before upload (`blank`), in the same words the loader uses (`TRANSPARENT_IMAGE_REASON`). Round 3 refused these only at generation (critic C6).
- **The renderer:** `next/og` (`@vercel/og`) rasterises the satori SVG with sharp, so librsvg and libxml2, whenever `await import("sharp")` succeeds inside it, and with resvg-wasm otherwise. sharp is a direct dependency and resolves from `next`, so production takes the sharp path; `src/lib/images/renderer-rasteriser.test.ts` fails if it stops resolving or loading from where `@vercel/og` imports it, or if `@vercel/og` drops its sharp branch. Every number below is measured on the sharp path.
- **Checking the real file at generation:** the renderer never sees the stored bytes. `loadDesignImage` returns bytes it encoded itself, or a `DesignImageError`.
  - **Why, decoding:** `next/og` is not safe to hand an uploaded file. An indexed PNG whose PLTE length is not a multiple of 3 panics its Rust PNG decoder, and the panic aborts the Node process (SIGABRT, exit 134), which no try/catch contains. Dozens of other well-framed PNGs and JPEGs it draws as nothing, or throws a `TypeError` on. A structural check cannot copy its decoder rule for rule (FEAT-033 upload round-2 critic).
  - **Why, size:** satori inlines each image as one base64 attribute, and libxml2 refuses an attribute over 10,000,000 characters. Bisected: an image of 7,499,820 bytes draws and one of 7,499,821 throws `XML parse error ... Resource limit exceeded` (`RENDERER_MAX_IMAGE_BYTES`). Round 3 bounded pixels but not bytes, so a real 2560 px cutout, exactly what the normaliser sends, passed the loader at 9.4 MB and threw inside `renderCompositeDesign` (round-3 critic B7). The limit is per attribute: two 6.5 MB images in one render draw.
  - **Cheap checks first:** the key, the 20 MB cap, the type sniff (`detectImageType`, PNG or JPEG only, matching the key), the 4096 px cap per side, then the structural pre-filter (`src/lib/images/decode-check.ts`: the IDAT stream inflates to exactly what the header promises; the JPEG has a frame, a scan and an end marker). The pre-filter refuses truncated uploads and decompression bombs before any decoder allocates for them.
  - **The re-encode:** `reencodeImage` (`src/lib/images/reencode.ts`) decodes with sharp 0.35.5 (libvips 8.18.7: libpng, mozjpeg) with `failOn: "warning"` and a 4096 x 4096 pixel limit, fits the result within 2560 px (`NORMALISED_LONG_EDGE`, the normaliser's own bound, so a client that skipped the normaliser gets the same size), and writes a fresh file: PNG stays PNG (alpha kept; adaptive filtering at zlib level 3, a fifth to a third smaller than unfiltered on photographic cutouts, where level 6 took up to 5 s on smooth 2560 px images), JPEG stays JPEG (quality 92, 4:4:4, baseline). Every output is 8-bit sRGB with no metadata: 16-bit becomes 8-bit, CMYK and ICC-tagged files are converted to sRGB, and EXIF orientation is applied, so the server shows what the browser showed. `width` and `height` are the output's. sharp never sees an SVG: only bytes that sniff and decode as PNG or JPEG reach it. The libvips operation cache is off (`sharp.cache(false)`): every image is unique, and the cache only held inputs (12 loads of a 4096 px progressive JPEG peaked at 1.35 GB with it, 0.53 GB without).
  - **The byte budget:** every output is at most 6,500,000 bytes (`RENDERER_IMAGE_BYTE_BUDGET`, about 1 MB under the measured limit). An encode over it is redone smaller: a JPEG first at quality 82 then 72, then any format at a smaller size, each step aiming just under the budget by area (ratio between 0.5 and 0.9 of the long edge). Steps stop at 1080 px, the width of every canvas; an image that still does not fit is refused as `too_detailed`. At most 6 encodes per file. In practice: JPEG photos never step (a 4096 px q95 noise JPEG, baseline, progressive or restart-marked, is 4.9 to 5.1 MB at 2560 and quality 92); real 2560 px cutouts land at 2047 to 2304 px; 4096 px noise lands at 1341 to 1656 px. Nothing under the caps reaches the floor (RGBA noise at 1080 px is 4.7 MB), so `too_detailed` exists for correctness, not because a file is known to hit it.
  - **Blank images:** a PNG with no pixel above alpha 0 draws exactly like no image, so it is refused (`blank`).
  - **What the gate proves:** every file in its corpus that the loader accepts is drawn by the real `next/og`, on the sharp path, in a child process: exit 0, no throw, and a render that differs from the no-image render. Every file it refuses carries `IMAGE_NOT_USABLE_PREFIX`, and any decoder failure is `unreadable`. The corpus is the round-2 hostile set (169 files), a 2560 px photographic RGBA cutout and the same photo as JPEG, and the critic's 4096 px attacker shapes (palette noise, grey noise, palette noise with tRNS, q95 noise JPEG baseline and progressive, and a noise JPEG with a restart marker after every MCU), each within the 20 MB and 4096 px caps. Every one of the size-limit images is also composed as the plate of a 1080 x 1350 design through `renderCompositeDesign`, in a child process (`composite-gate-child.mts`, run under tsx). Outside that corpus the size half holds by construction (no output exceeds 6.5 MB, under the measured 7,499,820), and the decode half rests on libvips refusing on the first warning; neither is proven for every possible file.
  - **The gate:** `design-image.render-gate.smoke.test.ts` builds its inputs in memory (`hostile-image-fixtures.ts`, `large-image-fixtures.ts`). It proves it can fail three ways: the raw PLTE-length file aborts the child with SIGABRT; the round-3 unbounded re-encode of the cutout throws libxml2's resource-limit error (code 114) in `renderCompositeDesign` in the child; and a padded PNG at exactly 7,499,820 bytes draws while one byte more throws, which also shows the gate is on the sharp path (resvg-wasm draws both). sharp cannot write restart markers, so the restart-marker JPEG is entropy-coded by hand (`restartMarkerNoiseJpeg`: random quantised coefficients, 10.4 MB, 262,143 markers); libvips decodes it strictly and it re-encodes to 5.05 MB at 2560 px.
  - **Brand logos** get the same re-encode before `probeLogo` (`loadBrandLogo`, `LOGO_REENCODE`): an 8192 x 8192 input limit, output fitted to 1024 px (a logo is drawn a few hundred px wide; at 4096 a valid 2560 px cutout re-encoded to 9.4 MB and was reported as damaged, critic C4), and one tolerance design images do not get. A JPEG whose only fault is a missing end marker is retried once with the marker appended: browsers draw it, logos saved that way drew before round 3 (critic C3), and a JPEG cut off inside its scan still fails the retry as corrupt. Design images stay strict because the normaliser always writes an end marker, so its absence means a PUT cut short, which "upload it again" fixes. An 8-bit sRGB PNG logo draws pixel for pixel the same (`logo-reencode.smoke.test.ts`).
  - **SVG logos** go through `sanitizeSvg` (`src/lib/images/svg-sanitize.ts`) before anything rasterises them, because librsvg decodes an embedded `data:image/png` with the same panicking decoder: one logo embedding the PLTE-length PNG aborted every design job for its brand and `POST /api/brand/logo-colors` (round-3 critic B8). `rasterizeSvg` takes only a `SafeSvg`, a type only `sanitizeSvg` produces, so `loadBrandLogo`, the logo-colors route and any future caller cannot skip it, and logos already in storage are covered because it runs on every render. `POST /api/upload` runs it too, on anything that declares or sniffs as SVG, so a bad file is refused at upload with "This SVG can't be used as a logo: {reason}. Export it again as a plain SVG, or upload a PNG." At render a refusal is the existing `NOT_DRAWABLE` fault.
    - **Parser:** saxes 6.0.0, a strict XML 1.0 parser with namespace support and no DTD processing, already in the lockfile as jsdom's parser and now a direct dependency. @xmldom/xmldom 0.8 (also in the lockfile, via mammoth) was rejected: it recovers from malformed input, so a sanitiser on it and libxml2 could read two different documents.
    - **Rules, each a refusal:** not well-formed, not UTF-8, or a root other than `<svg>` (SVG namespace or none); any DOCTYPE (entities are how a string check is walked around, and a logo never needs one); any href, in any namespace on any element, that is not a `#fragment`, except `data:image/png` or `data:image/jpeg` base64 on `<image>`, which is decoded and re-encoded through `reencodeImage` (1024 px, 4096 x 4096 input pixels, missing JPEG end marker tolerated) and written back; so nested SVG data URIs, `feImage` sources, `<a>`, `<use>` into another file and XInclude are all refused; `<set>`/`<animate*>` retargeting an href; `url()` to anything but a `#fragment` in any attribute or `<style>` block, `@import`, any backslash in a `<style>` block and a backslash beside a `(` in an attribute (a CSS escape can spell `url(` or `@import`); over 5 MB in, 6.5 MB out, 50,000 elements or 8 embedded images.
    - **Output:** serialised from the parse events, with comments, processing instructions and the XML declaration dropped, so the renderer parses exactly the document that was checked. A clean logo renders identically to the original.
    - **The gate:** `svg-sanitize.render-gate.smoke.test.ts` shows each of the critic's three `svg-embeds-*` files (rebuilt in memory, `hostile-svg-fixtures.ts`) still aborting the renderer raw, then refused by the sanitiser along with the external-href and XXE files, and draws everything the sanitiser lets through in a child process.
  - **Cost** (`corepack pnpm bench:reencode`: each case in a fresh process, one cold load then the median of 5 warm; peak RSS after one load, the process idles at 81 to 95 MB with the loader loaded):

    | Input | Output | Cold | Warm | Peak RSS, one load |
    |---|---|---|---|---|
    | 2560 x 2560 JPEG photo | 2560 px, 1.3 MB | 237 ms | 262 ms | 184 MB |
    | 2560 x 2560 RGBA PNG cutout (11.3 MB) | 1848 px, 4.9 MB | 1570 ms | 1577 ms | 180 MB |
    | 4096 x 4096 JPEG photo | 2560 px, 1.7 MB | 336 ms | 318 ms | 195 MB |
    | 4096 x 4096 palette noise + tRNS (16.8 MB) | 1341 px, 5.3 MB | 1627 ms | 1686 ms | 218 MB |
    | 4096 x 4096 progressive q95 noise JPEG (17.0 MB) | 2560 px, 4.9 MB | 1439 ms | 1327 ms | 224 MB |
    | SVG logo, 300 paths and one embedded 256 px PNG (0.35 MB) | 0.19 MB | 34 ms | 23 ms | 86 MB |

    Measured 2026-10-21 on a 22-core WSL2 machine at load average 5 to 6 from other work, so these run 20 to 40% above an idle machine.

    The critic's own files, with the critic's method: real 2560 px cutouts 0.95 to 1.0 s; the 4096 px tRNS noise 1.27 s cold and 1.41 s warm at 359 MB peak, against 3.5 s and 405 MB in round 3. **Budget:** one load stays under 2 s and 512 MB on this machine. Repeated loads in one long-lived process still grow RSS through glibc heap fragmentation (the progressive JPEG reaches 434 MB after 6 loads); that is the allocator, not this loader, and sharp's own advice for long-lived glibc processes is jemalloc.
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
  - `src/lib/uploads/normalize-image.ts` (browser): `normalizeImageForUpload(file: File): Promise<{ blob: Blob; type: "image/png" | "image/jpeg"; width: number; height: number }>`. It throws `ImageNotUsableError` with a user-facing message; a fully transparent image is `blank`.
  - `src/lib/uploads/design-image.ts` (server):
    - `designImageKeyFor(brandId, ext)`
    - `isDesignImageKeyFor(key, brandId)`
    - `loadDesignImage(key, brandId)`: returns `{ bytes, contentType, width, height }`, or throws `DesignImageError` with a user-facing message. `bytes` is the server's re-encode, never the stored file, and `width` and `height` are its size after EXIF orientation. Faults: `foreign_key`, `missing`, `too_large`, `not_png_or_jpeg`, `type_mismatch`, `unreadable`, `too_many_pixels`, `too_detailed`, `blank`. The output is at most 2560 px and 6,500,000 bytes.
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
