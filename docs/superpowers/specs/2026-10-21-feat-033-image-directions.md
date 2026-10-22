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
  - **Why:** satori cannot draw WEBP (see `run-design-generation.ts` on "u2 is not iterable"), and phone photos arrive at 7000+ px while the server fits every image to 2560 px anyway, so a bigger upload is bytes nobody draws.
  - **Free fixes:** re-encoding through `createImageBitmap` also applies EXIF orientation, and strips EXIF metadata such as location. A browser that rejects the `imageOrientation` option with a `TypeError` is retried without it.
  - **Too many pixels:** a file whose header declares more than 100 megapixels (a decompression bomb, or a photo no phone browser can hold decoded) is refused before decoding as too large, not as damaged.
  - **Fully transparent:** an image with no pixel above alpha 0 is refused before upload (`blank`), in the same words the loader uses (`TRANSPARENT_IMAGE_REASON`). Round 3 refused these only at generation (critic C6).
  - **Blank or subject-free:** an image that looks blank, or almost all one colour, is refused before upload (`no_subject`, `NO_SUBJECT_REASON`: "it looks blank, or almost all one colour, so there is nothing in it to show. Choose a photo with your product, place or people in it."), by the same check the loader runs; see "Blank and subject-free images" below. Without it a photo of a white sheet became a design's hero (U3 live critic, photo-a).
- **The renderer:** `next/og` (`@vercel/og`) rasterises the satori SVG with sharp, so librsvg and libxml2, whenever `await import("sharp")` succeeds inside it, and with resvg-wasm otherwise. sharp is a direct dependency and resolves from `next`, so production takes the sharp path; `src/lib/images/renderer-rasteriser.test.ts` fails if it stops resolving or loading from where `@vercel/og` imports it, or if `@vercel/og` drops its sharp branch. Every number below is measured on the sharp path.
- **Checking the real file at generation:** the renderer never sees the stored bytes. `loadDesignImage` returns bytes it encoded itself, or a `DesignImageError`.
  - **Why, decoding:** `next/og` is not safe to hand an uploaded file. An indexed PNG whose PLTE length is not a multiple of 3 panics its Rust PNG decoder, and the panic aborts the Node process (SIGABRT, exit 134), which no try/catch contains. Dozens of other well-framed PNGs and JPEGs it draws as nothing, or throws a `TypeError` on. A structural check cannot copy its decoder rule for rule (FEAT-033 upload round-2 critic).
  - **Why, size:** satori inlines each image as one base64 attribute, and libxml2 refuses an attribute over 10,000,000 characters. Bisected: an image of 7,499,820 bytes draws and one of 7,499,821 throws `XML parse error ... Resource limit exceeded` (`RENDERER_MAX_IMAGE_BYTES`). Round 3 bounded pixels but not bytes, so a real 2560 px cutout, exactly what the normaliser sends, passed the loader at 9.4 MB and threw inside `renderCompositeDesign` (round-3 critic B7). The limit is per attribute: two 6.5 MB images in one render draw.
  - **Cheap checks first:** the key, the 20 MB cap, the type sniff (`detectImageType`, PNG or JPEG only, matching the key), the 4096 px cap per side, the JPEG frame type, then the structural pre-filter (`src/lib/images/decode-check.ts`: the IDAT stream inflates to exactly what the header promises; the JPEG has a frame, a scan and an end marker). The pre-filter refuses truncated uploads and decompression bombs before any decoder allocates for them.
  - **JPEG frame types:** only Huffman-coded baseline, extended and progressive frames (SOF0 to SOF2) are accepted, and only one. Lossless (C3), hierarchical (C5 to C7) and arithmetic-coded (C9 to CB, CD to CF) frames are refused as `unsupported_jpeg` ("it is saved in a kind of JPEG most apps can't open. Save it again as a standard JPEG or PNG."), by `jpegHasUndrawableFrame` before decoding, in `loadDesignImage` and in `reencodeImage` itself, so brand logos and JPEGs embedded in SVG logos get it too. Browsers draw none of them, so the normaliser never writes one, and libvips decoded an arithmetic marker over Huffman data as noise without a warning (round-4 critic C3).
  - **The re-encode:** `reencodeImage` (`src/lib/images/reencode.ts`) decodes with sharp 0.35.5 (libvips 8.18.7: libpng, mozjpeg) with `failOn: "warning"` and a 4096 x 4096 pixel limit, fits the result within 2560 px (`NORMALISED_LONG_EDGE`, the normaliser's own bound, so a client that skipped the normaliser gets the same size), and writes a fresh file: PNG stays PNG (alpha kept; adaptive filtering at zlib level 3, a fifth to a third smaller than unfiltered on photographic cutouts, where level 6 took up to 5 s on smooth 2560 px images), JPEG stays JPEG (quality 92, 4:4:4, baseline, Huffman tables not optimised: optimisation buffers every coefficient for a second pass, and under glibc those buffers stayed resident, about 90 MB per encode of a 2560 px image; pixels are identical and files 8 to 16% larger). Every output is 8-bit sRGB with no metadata: 16-bit becomes 8-bit, CMYK and ICC-tagged files are converted to sRGB, and EXIF orientation is applied, so the server shows what the browser showed. `width` and `height` are the output's. sharp never sees an SVG: only bytes that sniff and decode as PNG or JPEG reach it. The libvips operation cache is off (`sharp.cache(false)`): every image is unique, and the cache only held inputs (12 loads of a 4096 px progressive JPEG peaked at 1.35 GB with it, 0.53 GB without).
  - **The byte budget:** every output is at most 6,500,000 bytes (`RENDERER_IMAGE_BYTE_BUDGET`, about 1 MB under the measured limit). An encode over it is redone smaller: a JPEG first at quality 82 then 72, then any format at a smaller size, each step aiming just under the budget by area (ratio between 0.5 and 0.9 of the long edge). Steps stop at 1080 px, the width of every canvas; an image that still does not fit is refused as `too_detailed`. At most 6 encodes per file. A full encode of a dense 2560 px image is thrown away whenever it comes out over budget, so the steps are first walked on a prediction: 8 evenly spaced bands of 32 rows are encoded and scaled up (within 4% of the full size on real cutouts, photos and noise), and only the first step predicted to fit within 115% of the budget is encoded in full. The full encode still decides; a prediction never accepts or refuses. Images under 1024 rows are not predicted. In practice: JPEG photos never step (a 4096 px q95 noise JPEG, baseline, progressive or restart-marked, is 4.9 to 5.1 MB at 2560 and quality 92); real 2560 px cutouts land at 2047 to 2304 px; 4096 px noise lands at 1341 to 1656 px. Nothing under the caps reaches the floor (RGBA noise at 1080 px is 4.7 MB), so `too_detailed` exists for correctness, not because a file is known to hit it.
  - **Blank images:** a PNG with no pixel above alpha 0 draws exactly like no image, so it is refused (`blank`).
  - **Blank and subject-free images** (`src/lib/uploads/subject-check.ts`, framework-free so the browser normaliser and the loader run the same code on the same numbers). The re-encode also returns an RGBA thumbnail fitted in 64 px (`SUBJECT_THUMBNAIL_SIDE`); the browser draws its own from the normalised canvas. Two measures on it, with transparent pixels composited on mid grey and alpha counted as a fourth channel so a cutout's silhouette is a subject whatever its colour:
    - **coverage:** the share of pixels more than 24 (of 255, `SUBJECT_DEVIATION`) from the image's per-channel median in any channel. A product on white is a small share far from white; a wall texture is every pixel a little off white, which the downscale averages away.
    - **edge energy:** the mean over pixels of the largest channel's |dx| + |dy|, for structure with no region far from the median.
    - An image is refused as `no_subject` only when coverage is under 0.2% (`MIN_SUBJECT_COVERAGE`, about 8 pixels of a 64 x 64) **and** edge energy is under 8 (`MIN_EDGE_ENERGY`). Mean brightness is not used: a white sheet and a small dark bottle on a white table both average near white.
    - **Measured** (server thumbnail via libvips / browser thumbnail via headless Chromium canvas; real photos normalised to 2560 px JPEG q90 first, as the browser does):

      | Image | Coverage | Edge energy | Result |
      |---|---|---|---|
      | photo-a.jpg, near-white photo (mean 254.7, sd 0.5) | 0% / 0% | 0.24 / 0.98 | refused |
      | photo-b.jpg, white wall texture | 0% / 0% | 2.42 / 2.26 | refused |
      | cutout.png, real product cutout | 20.9% / 20.8% | 17.7 / 16.8 | accepted |
      | busy-cafe-espresso.jpg | 59.8% / 60.3% | 38.1 / 33.8 | accepted |
      | busy-storefront-24mp.jpg | 74.3% / 72.6% | 32.1 / 28.5 | accepted |
      | sky-over-stone.jpg, half flat sky | 83.1% / 83.2% | 20.0 / 17.6 | accepted |
      | portrait-fashion.jpg | 87.5% / 85.7% | 45.7 / 39.9 | accepted |
      | generated: dark bottle 5% of the frame wide on white | 0.78% (browser) | 1.07 | accepted |
      | generated: pale grey (#d6d6d6) product 10% wide on white | 2.05% (browser) | 0.4 | accepted |
      | generated: white product with outline and soft shadow | 1.27% (browser) | 1.05 | accepted |
      | generated: solid colour, solid black | 0% | 0 | refused |

    - **Why these thresholds:** photo-b's texture is the borderline case. One pixel of its 2,752 (a dark speck) deviates 22 from the median, close to 24, but coverage needs about 8 pixels past the line and only 3 deviate more than 12, so even half the deviation threshold would still refuse it; its edge energy of 2.3 to 2.4 is under a third of 8. Every real photo is above 16.8 edge energy and 20% coverage, so either measure alone accepts it. The deviation of 24 still counts a pale grey product (#d6d6d6, 41 from white). The smallest legitimate subject tested, a dark bottle 5% of the frame wide, covers 0.78%, four times the floor; a product much under 3% of the frame wide on plain white is refused, and is too small to carry a design anyway.
    - **Known consequence:** pure noise averages to flat grey at 64 px and is refused as `no_subject` too, after its full re-encode (so its cost below is still the full cost). So is a fine, even texture shot flat on, which is what photo-b is.
    - **Cost:** the thumbnail adds 0 to 10 ms to a re-encode; the measure takes 0.5 to 1.2 ms (median, 20 runs) on each fixture. `corepack pnpm eval:subject-check [dir] [expectations.json]` runs the real normaliser in headless Chromium on a folder of photos and exits 1 on any miss; `subject-check.test.ts` and `design-image.subject.test.ts` hold the generated cases (`subject-fixtures.ts`) on both resamplers.
  - **What the gate proves:** every file in its corpus that the loader accepts is drawn by the real `next/og`, on the sharp path, in a child process: exit 0, no throw, and a render that differs from the no-image render. Every file it refuses carries `IMAGE_NOT_USABLE_PREFIX`, and any decoder failure is `unreadable`. The corpus is the round-2 hostile set (169 files), a 2560 px photographic RGBA cutout and the same photo as JPEG, and the critic's 4096 px attacker shapes (palette noise, grey noise, palette noise with tRNS, q95 noise JPEG baseline and progressive, and a noise JPEG with a restart marker after every MCU), each within the 20 MB and 4096 px caps. Every one of the size-limit images is also composed as the plate of a 1080 x 1350 design through `renderCompositeDesign`, in a child process (`composite-gate-child.mts`, run under tsx). Outside that corpus the size half holds by construction (no output exceeds 6.5 MB, under the measured 7,499,820), and the decode half rests on libvips refusing on the first warning; neither is proven for every possible file.
  - **The gate:** `design-image.render-gate.smoke.test.ts` builds its inputs in memory (`hostile-image-fixtures.ts`, `large-image-fixtures.ts`). It proves it can fail three ways: the raw PLTE-length file aborts the child with SIGABRT; the round-3 unbounded re-encode of the cutout throws libxml2's resource-limit error (code 114) in `renderCompositeDesign` in the child; and a padded PNG at exactly 7,499,820 bytes draws while one byte more throws, which also shows the gate is on the sharp path (resvg-wasm draws both). sharp cannot write restart markers, so the restart-marker JPEG is entropy-coded by hand (`restartMarkerNoiseJpeg`: random quantised coefficients, 10.4 MB, 262,143 markers); libvips decodes it strictly and it re-encodes to 5.05 MB at 2560 px.
  - **Brand logos** get the same re-encode before `probeLogo` (`loadBrandLogo`, `LOGO_REENCODE`): an 8192 x 8192 input limit, output fitted to 1024 px (a logo is drawn a few hundred px wide; at 4096 a valid 2560 px cutout re-encoded to 9.4 MB and was reported as damaged, critic C4), and one tolerance design images do not get. A JPEG whose only fault is a missing end marker is retried once with the marker appended: browsers draw it, logos saved that way drew before round 3 (critic C3), and a JPEG cut off inside its scan still fails the retry as corrupt. Design images stay strict because the normaliser always writes an end marker, so its absence means a PUT cut short, which "upload it again" fixes. An 8-bit sRGB PNG logo draws pixel for pixel the same (`logo-reencode.smoke.test.ts`).
  - **SVG logos** go through `sanitizeSvg` (`src/lib/images/svg-sanitize.ts`) before anything rasterises them, because librsvg decodes an embedded `data:image/png` with the same panicking decoder: one logo embedding the PLTE-length PNG aborted every design job for its brand and `POST /api/brand/logo-colors` (round-3 critic B8). `rasterizeSvg` takes only a `SafeSvg`, a type only `sanitizeSvg` produces, so `loadBrandLogo`, the logo-colors route and any future caller cannot skip it, and logos already in storage are covered because it runs on every render. `POST /api/upload` runs it too, on anything that declares or sniffs as SVG, so a bad file is refused at upload with "This SVG can't be used as a logo: {reason}. Export it again as a plain SVG, or upload a PNG." At render a refusal is the existing `NOT_DRAWABLE` fault.
    - **Parser:** saxes 6.0.0, a strict XML 1.0 parser with namespace support and no DTD processing, already in the lockfile as jsdom's parser and now a direct dependency. @xmldom/xmldom 0.8 (also in the lockfile, via mammoth) was rejected: it recovers from malformed input, so a sanitiser on it and libxml2 could read two different documents.
    - **Rules, each a refusal:** not well-formed, not UTF-8, or a root other than `<svg>` (SVG namespace or none); any DOCTYPE (entities are how a string check is walked around, and a logo never needs one); any href, in any namespace on any element, that is not a `#fragment`, except `data:image/png` or `data:image/jpeg` base64 on `<image>`, which is decoded and re-encoded through `reencodeImage` (1024 px, 4096 x 4096 input pixels, missing JPEG end marker tolerated) and written back; so nested SVG data URIs, `feImage` sources, `<a>`, `<use>` into another file and XInclude are all refused; `<set>`/`<animate*>` retargeting an href; `url()` to anything but a `#fragment` in any attribute or `<style>` block, `@import`, any backslash in a `<style>` block and a backslash beside a `(` in an attribute (a CSS escape can spell `url(` or `@import`); over 5 MB in, 6.5 MB out, 50,000 elements or 8 embedded images. Added by the round-5 attack corpus: a `src` attribute is held to the href rule, and `xml:base` (which turns a `#fragment` into a URL) is refused; any `<script>` or `on*` event attribute (`active_content`: neither rasteriser runs them, but the upload route stores the file as uploaded on the public bucket); nesting over 100 deep (libxml2 stops at 256), an element or attribute name over 1,000 characters (libxml2 stops at 50,000), `<use>` references that expand past 100,000 drawn elements or 100 levels, or form a cycle (ten levels of ten took librsvg 8.6 s to give up on), counted without recursion; a root viewBox, width or height with a coordinate over 1,000,000 or proportions past 100:1 (`bad_dimensions`).
    - **Namespaces:** SVG elements are written unprefixed under one default namespace declared on the root, and every other default `xmlns` is dropped. A prefixed root (`<s:svg xmlns:s="http://www.w3.org/2000/svg">`) is valid XML the upload accepts, and satori, which finds an image's size by looking for `<svg`, failed it as undrawable; a nested default namespace would otherwise move unprefixed children out of the SVG namespace. `detectImageType` recognises a prefixed root as SVG for the same reason.
    - **Raster size:** `svgRasterBox` bounds the raster at 1,000,000 pixels (`MAX_RASTER_PIXELS`) as well as 4096 px a side. A tall logo's 600 x 4096 box filled with incompressible noise (a tiled noise PNG, or `feTurbulence`) encoded to 8.4 to 8.7 MB and threw in the renderer (round-4 critic C4). A PNG of noise is about 4 bytes a pixel, so a million pixels is at most about 4 MB whatever the SVG draws: measured 3.70 MB for the tiled noise PNG and 3.53 MB for `feTurbulence` at 600 x 1666, against the 6.5 MB budget and the 7,499,820-byte limit. A tall mark is still 1,666 px high, several times what it is drawn at.
    - **Output:** serialised from the parse events, with comments, processing instructions and the XML declaration dropped, so the renderer parses exactly the document that was checked. A clean logo renders identically to the original.
    - **The gate:** `svg-sanitize.render-gate.smoke.test.ts` shows each of the critic's three `svg-embeds-*` files (rebuilt in memory, `hostile-svg-fixtures.ts`) still aborting the renderer raw, then refused by the sanitiser along with the external-href and XXE files, and draws everything the sanitiser lets through in a child process.
    - **The attack corpus:** `svg-attack.render-gate.smoke.test.ts` builds 94 files in memory (`svg-attack-fixtures.ts`: entities, CDATA, namespaces and prefixed hrefs, `xlink:href` against `href`, nested `<svg>`, `<use>`/`feImage`/pattern/mask/filter references, CSS `url()` in style attributes and `<style>`, `foreignObject`, huge and extreme dimensions, data URIs with odd media types, parameters and base64 padding, svgz and UTF-16, the PLTE-length-4 PNG by `href`, by `xlink:href` and inside a nested SVG data URI, the two tall noisy logos, and the element-count limit from both sides) and runs every file through the three real entry points, each path in a child process of its own (`svg-attack-child.mts`): `POST /api/upload`, `POST /api/brand/logo-colors`, and `loadBrandLogo` followed by a full design through `renderCompositeDesign` with the logo, compared with the same design without it. Session, database, rate limiter and vision model are stubbed by module hooks (`route-stubs/`); storage is the real module over a stubbed S3 client. Each child must exit 0 having reached the last file, nothing may throw out of a handler, every refusal tells the uploader why in the sanitiser's words (the route's own 5 MB cap answers first for the oversized file), a refused logo is a logo file fault, and every drawn logo is drawn and within the byte budget. Run 2026-10-22: 66 refused, 26 drawn and 2 not SVG on every path, 0 aborts, 0 throws; per file p50 2 to 3 ms, slowest 1.9 s through logo-colors (the 50,000-element file) and 6.4 s through the logo path (a tall noise logo, of which about 3.8 s is loading it and the rest two full designs). A second test proves the C4 case can fail: the same tall noisy logos rasterised at round 4's 600 x 4096 throw libxml2's resource-limit error (code 114) in the renderer.
  - **Cost** (`corepack pnpm bench:reencode`: each case in a fresh process, one cold load then the median of 5 warm; peak RSS is the process's VmHWM after one load, the process idles at 82 to 100 MB with the loader loaded):

    | Input | Output | Cold | Warm | Peak RSS, one load |
    |---|---|---|---|---|
    | 2560 x 2560 JPEG photo | 2560 px, 1.4 MB | 103 ms | 91 ms | 118 MB |
    | 2560 x 2560 RGBA PNG cutout (11.3 MB) | 1841 px, 4.9 MB | 723 ms | 720 ms | 180 MB |
    | 4096 x 4096 JPEG photo | 2560 px, 1.9 MB | 292 ms | 250 ms | 126 MB |
    | 4096 x 4096 palette noise + tRNS (16.8 MB) | 1341 px, 5.3 MB | 1067 ms | 801 ms | 204 MB |
    | 4096 x 4096 progressive q95 noise JPEG (17.0 MB) | 2560 px, 5.1 MB | 906 ms | 840 ms | 183 MB |
    | SVG logo, 300 paths and one embedded 256 px PNG (0.35 MB) | 0.19 MB | 39 ms | 27 ms | 89 MB |

    Measured 2026-10-22 on a 10-core WSL2 machine at load average 3 to 4 from other work.

  - **What one load costs, end to end** (`loadDesignImage` in a fresh process, `load-budget-child.mts`; wall time, and peak RSS as VmHWM, because Linux carries a parent's peak RSS at fork into a child's `maxRSS`). The round-4 critic's C1 file, a 2560 px progressive q100 4:4:4 noise JPEG of 19.2 MB, measured 1.84 to 2.57 s and 517 to 534 MB on round 4 (1.51 to 1.67 s and 519 to 540 MB re-measured here). Round 5:

    | File | Outcome | Wall p50 / p95 / max | Peak RSS p50 / p95 / max |
    |---|---|---|---|
    | noise-2560-q100-prog.jpg (the C1 file), 5 runs | refused `no_subject` after the full re-encode | 451 / 498 / 498 ms | 216 / 217 / 217 MB |
    | the same, 18 runs 6 at a time (load average 4 to 5 on 10 cores) | | 698 / 751 / 751 ms | 215 / 219 / 219 MB |
    | the same noise with a black square in the middle, 5 runs | accepted, 2304 px, 5.1 MB | 451 / 534 / 534 ms | 223 / 225 / 225 MB |
    | 2560 px RGBA PNG cutout, 19.4 MB unfiltered (critic's size-cutout-2560-l0) | accepted, 2200 px, 1.3 MB | 504 / 516 / 516 ms | 207 / 210 / 210 MB |
    | 2560 px grainy cafe photo, RGBA PNG with circular alpha, 12.7 MB | accepted, 1728 px, 4.3 MB | 509 / 522 / 522 ms | 196 / 201 / 201 MB |
    | 4096 px RGBA cutout (critic's size-cutout-4096), the slowest file found | accepted, 2560 px, 1.7 MB | 1160 / 1171 / 1171 ms | 219 / 229 / 229 MB |
    | each real fixture, normalised to 2560 px, 3 runs | accepted or refused as above | max 121 to 378 ms | max 116 to 131 MB |

    All 43 of the round-4 critic's raster size files: max 1.17 s and 233 MB. Where the time and memory went: with Huffman optimisation on, the accepted noise JPEG took 860 ms and peaked at 337 to 389 MB; without the size prediction it took 615 to 738 ms. **Budget:** one load stays under 2 s and 512 MB, with the costliest file found at 1.17 s and 233 MB. `load-budget.smoke.test.ts` gates it on the C1 file, the same noise with a subject, and a 2560 px RGBA cutout, each in a fresh process: peak RSS under 512 MB and CPU time under 2 s (CPU, not wall, because the suite saturates every core while it runs; round 4's 519 to 540 MB fails it). Repeated loads in one long-lived process still grow RSS through glibc heap fragmentation (the bench's palette noise reaches 394 MB after 6 loads); that is the allocator, not this loader, and sharp's own advice for long-lived glibc processes is jemalloc.
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
