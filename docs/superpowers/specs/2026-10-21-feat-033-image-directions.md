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
- `break-word` only on a line at least `minBreakableWidth` wide: the run's longest grapheme cluster in code points, times `MAX_GLYPH_EM` (4 em, the widest advance a face may have) plus tracking. `font-file.ts` measures every glyph of a face, not the ones a cmap range is expected to reach, from every place satori's parser takes an advance: hmtx for all glyphs including `.notdef` (drawn for a code point no face covers), the charstring width of every CFF glyph (which replaces the hmtx advance once the glyph is drawn), and pair kerning (GPOS PairPos and the kern table), held to glyph plus widest kern within 4 em. A face past it is refused at upload and again whenever any face is loaded for a render (a stored brand face, a vendored face, the Google fallback for one), so the render keeps the bundled faces and reports why. Satori never returns when it has to break a line narrower than one grapheme cluster, so a box an edit drags narrower than that overflows instead of hanging the renderer.
- **No render can hold the server.** Every satori and resvg call that draws copy runs in a pool of worker threads (`render/satori-pool.ts`, `satori-worker.cjs`; 2 by default, `KOOS_RENDER_WORKERS` up to 8) with a wall-clock limit per render. A render past it is terminated and rejects with `RenderTimeoutError` (`RENDER_TIMEOUT`), and a fresh worker takes its place; the other workers keep drawing, so one stuck document never stalls another tenant's render. The job does not retry a timed-out render. Overhead is about 0.4 ms per text probe and 1 ms per full 1080x1350 render. A grapheme of stacked combining marks wider than its line looped satori forever before this.
- **Copy is checked at the schema boundary** (`document/text-safety.ts`): normalised to NFC, then refused with a typed fault the user can read when the renderer cannot draw it correctly. Satori has no shaping, bidi or mark positioning, so Arabic (throws), Hebrew (drawn backwards), Devanagari and the other Indic scripts (bare viramas), Thai (stacked marks collide) and Khmer (empty boxes) are refused (`TEXT_SCRIPT_UNSUPPORTED`), as is an accent with no precomposed letter such as Yoruba ẹ́ (`TEXT_ACCENT_UNSUPPORTED`). Armenian, Georgian and polytonic Greek are refused too: satori draws them, but from fallback faces a browser does not pick, so the editor drew them up to 46 px past the box. Normalising also composes Hangul typed as jamo into syllables and removes what draws nothing: text-presentation and variation selectors, tag characters outside the three subdivision flags, and joiners outside a real emoji sequence (at most 4 people). After that every cluster of several code points is either an emoji sequence satori draws as one 1em picture or is refused: more than 2 marks or jamo that form no syllable (`TEXT_CLUSTER_TOO_COMPLEX`), or an accent with no precomposed letter (`TEXT_ACCENT_UNSUPPORTED`). `cluster-fuzz.smoke.test.ts` generates clusters from every kind of code point a cluster can be built from and draws each one the schema keeps at the narrowest width words still break in. Direction overrides and control characters are refused (`TEXT_CONTROL_CHARACTER`), and a run and a whole document each hold at most 24 distinct emoji. `specTextFault(spec)` gives the job the same fault before it builds; `documentFromSpec` raises it as `DocumentTextFault` when a caller skipped that.
- **Cost is bounded by count, not just size** (`DOCUMENT_LIMITS`): at most 18 elements, and per type 2 images, 5 shapes, 8 text runs, 2 buttons and 2 logos, per role 2 headlines, 2 subheadlines, 2 CTAs, 3 footer lines and 3 body runs, 2 gradient fills of at most 5 stops, 600 code points of copy in all (a run at most 400) and 24 distinct emoji. The costliest document the caps allow (`testing-cost.ts`: the copy budget in the densest Han glyphs, at the largest size, rotated over every element) draws in 2.1-2.5 s alone and 2.2-2.8 s two at once on the pool (10-core dev machine, 2026-10-23 and 2026-10-24, with other work running). The 3 s bound is checked by `corepack pnpm bench:document-cost` (periodic lane: run it on an idle machine before shipping any change to `DOCUMENT_LIMITS` or the renderer; it exits 1 over the bound), not by a gate test, because wall-clock time failed the gate suite whenever the machine was busy. The gate, `cost.smoke.test.ts`, holds what is deterministic: the worst case still draws, alone and two at once, and two gates hold the bounds. `cost-bounds.test.ts` drives every bound through the real parser: each numeric bound the schema declares (read from the schema with `z.toJSONSchema`), the copy lengths, every count `DOCUMENT_LIMITS` sets, the copy budget, gradient stops and both emoji caps parse at the bound, come back unchanged, and are refused one step past it, and no element number may lack a floor and a ceiling. That catches a bound loosened anywhere it is enforced: in a union branch, a transform, a refinement, or deleted outright. `cost.smoke.test.ts` compares the declared bounds with `cost-bench.json`, which `corepack pnpm bench:document-cost --record` writes only when both figures are under the bound, with a digest of the caps it timed, so a deliberate change is re-timed before it lands. Rewrites that change no bound (`.lte` for `.max`, `z.coerce` with the same limits) pass both gates; they cost nothing. The worst case is built from the schema's own extremes (reach, type size, leading and tracking low ends, border width, radius, crop zoom), so the bench times whatever the schema allows. `rasterizeDocument` reads each asset's header and refuses one over `MAX_DOCUMENT_ASSET_EDGE` (4096 px) on a side, one whose size it cannot read, or a JPEG with two frame headers, with `DocumentAssetError`, before it decodes anything: an 8192 px image took 3.5 s and 5.2 GB to draw. Uploads reach it already fitted to 2560 px and logos to 1024 px; a generated plate must be fitted to the same 2560 px before it is drawn, because an image model's 4K output (about 3072 x 5504 at 9:16) is refused here. Text probes run under a 10 s limit in production; tests pass `TEST_PROBE_LIMIT_MS` (60 s) because the limit also spends a cold worker's start and fallback-face fetches, which a loaded machine stretched past 10 s with no loop present. A process's first render also pays the handshakes for the fallback faces and emoji next/og fetches, about 2 s whatever the emoji count, which the render limit bounds. An `rgb()` channel over 255 is refused, not clamped.
- The same function runs in the editor. `browser-parity.smoke.test.ts` draws every builder output in Chromium and in satori and holds both inside every box. The editor must turn off kerning and ligatures (`SATORI_SHAPING`, satori applies neither), serve CJK from Noto Sans JP inside the brand families (unicode-range U+3000-30FF, U+4E00-9FFF, U+FF00-FFEF), and register its colour-emoji face as a family of its own, `EMOJI_FONT_FAMILY`, sized to a 1em advance. Every run lists that family after the brand's (`textRunStyle`; satori skips a family it has no face for), so a browser draws a whole cluster the brand cannot (ZWJ sequence, flag, keycap, pictograph) as one emoji picture, as satori does, and a plain © or ↔ in the brand face, as satori does. A unicode-range emoji face inside the brand family drew keycaps as the brand's digit plus a combining keycap, 18 px past the box.

`rasterizeDocument({ doc, assets, brand, logoInk?, fonts? }) → { bytes, document, logoFault, brandFontFault }` goes through `createBrandRasterizer` and `logoBackingOnGround` in `render/rasterize.ts`, the same two functions the flex composite uses. One brand-font fallback and one logo-backing measurement, shared.

### `src/lib/design/document/from-spec.ts`

`documentFromSpec({ spec, palette, canvas, image: AssetRef|null, imageFacts?, subject?, logo, measurer }) → { document, copyFault, subjectFault }`.

- **One builder per existing layout**, one file each under `document/builders/`: `hero-center`, `split-left`, `banner-bottom`, `quote-card` and `stat-highlight`, over shared geometry, copy stack and footer.
- **Explicit geometry:** each builder computes boxes for the same zones the flex layout produces today, from canvas width and height, with the flex layouts' own `HEADLINE_STEPS`, `BANNER_BAND` and `footerBandHeight`.
- **Text that fits:** sizes are fitted by laying the copy out through satori itself (`measure.tsx`), so it is exact for the PNG. Every run is measured 2% narrower than it is drawn, which is the room Chromium needs. It needs `next/og`, so it runs on the server; the editor's in-browser estimate and the re-fit on save are PR 2 (table above).
- **Copy faults, never silent:** below the type scale, copy shrinks toward a legibility floor (1.9% of the short side); below the floor a word breaks instead. Either is reported in `copyFault` (`COPY_SHRUNK`, `COPY_WORD_BROKEN`, or `COPY_TOO_LONG` when even that overflows), for the job to surface as a quality fault.
- **Card layouts hold the image inside the card**, clipped to its rounded corners, on a flat ground. A cut-out sits whole in the top of the card with the copy below it, stepping its share of the canvas down (42%, 36%, 30%) before it would ever be laid under the copy; a photograph fills the card with the copy anchored low over its measured veil.
- **The footer does not repeat the CTA or a line of the copy above it, and never loses a fact.** `footerLinesFor` (render/footer.ts, shared with the flex renderer and the judge) drops a footer item that is the CTA, part of it, or contains it with no fact of its own (a number, a day or month, an address, a proper noun); an item with a fact is kept whole ("Call 0803 555 0142 to book a table"). It keeps what follows a CTA used as a label ("Order on WhatsApp: 0803..." keeps the number) unless the CTA leads into a clause ("Order now and save 20%" stays whole), and starts a line that lost its first item with a capital unless it starts with an address or a mixed-case name ("iOS"). Against the headline and subheadline only a whole line said there word for word is dropped: offers, conditions, exclusions and list items are never cut ("Free delivery in Lekki" stays under "Now baking in Lekki").
- **The headline keeps the hierarchy when room is short.** When the headline would have to leave its type scale, the stack is laid out again with the quote mark, button and gaps at `COMPACT_SCALE` (60%), and the larger headline wins, so a 21px headline never sits under a 160px quote mark.
- **Headlines avoid a lone last word.** When the balanced headline ends on one word, the builder takes one more line at the same size if the zone allows (`widthWithoutOrphan`).
- **Ink, not the line box, is kept inside the element.** The measurer reads how far each run's glyphs reach above and below its line box (`inkExtent`), so Vietnamese stacked capitals and emoji pictures stay inside their elements in both engines.
- **The subject is kept clear and large** (`document/subject.ts`). `documentFromSpec` takes an optional `subject: {x, y, w, h}` in image shares; a cut-out's comes from its alpha bounds. Every layout keeps the headline, subheadline, CTA, accent rule, quote mark, footer lines and logo out of the subject grown by 2% of the short side, and draws the subject whole with its longer edge at least 35% of the canvas's shorter side (a 1080 post seen at 360 px on a phone still shows the product 126 px across). A layout tries its alternative arrangements (copy low, copy high, subject in a band above the copy, a photo inset in a smaller rounded frame when its subject cannot be whole edge to edge, then the mirrored logo corner) and otherwise reports `subjectFault` (`SUBJECT_COVERED` or `SUBJECT_CROPPED`); it never overlaps silently. An inset photo never runs under the logo: the mark sits wholly on the ground. It lines up with the copy: on the canvas axis under centred copy (hero-center), from the text column's left edge under flush-left copy (banner-bottom). A subject box out of range, with a NaN, or under 2% of the image on a side is refused with `SubjectBoxFault` (`SUBJECT_BOX_INVALID`), never clamped or dropped. A cut-out's box is read from alpha with the matting's veil and debris (specks, hairlines, patches under 5% of the subject's weight) left out. The headline leads: when it would fall under 1.5 times the footer's type, the footer drops to its smallest size first, then a card's subject steps down to 70% of its minimum (with `SUBJECT_CROPPED`), and only then does the headline shrink. The CTA label is never under 2.6% of the short side. `measureSubject(doc, imageSize, subject)` is the same rule as a measurement for the job and the eval.
- **Images, measured:** `imageFacts` comes from `measureImage(bytes)` (`document/image-facts.ts`). A cut-out (transparent PNG) is contained and sized by its visible pixels, never cropped. Copy over a photograph gets a veil graded to each run of copy (`builders/scrim.ts`): each run needs the least alpha at which every pixel of its own box clears its target (3:1 for large type, 48 px or 37 px bold; 4.5:1 otherwise), the veil rises into each run no steeper than 2.4 alpha per box height and over at least 25% of the box into its peak, never as coincident stops. Of white, the brand's text colour and near-black, the text colour whose veil changes the photo's lightness (CIE L*) least is used, so a pale sky over dark stone takes dark type over a light veil instead of a grey slab. Hero-center without a subject sets its copy low or high, whichever needs the lighter veil. Dark type and no veil on a bright photo, white type and no veil on a dark one. Without facts, the photo is treated as the worst case.

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
- **The key is built from the brand row** (`access.brand.id`), never from the request string, so an uppercase UUID that Postgres matches cannot reach `designImageKeyFor` and 500.
- **Normalised in the browser:** before upload the browser re-encodes every image to fit within 2560 px on the long edge.
  - An image with any transparent pixel (PNG or WEBP) becomes PNG, so the transparency survives. Every opaque image becomes JPEG, which is far smaller for photos.
  - **Why:** satori cannot draw WEBP (see `run-design-generation.ts` on "u2 is not iterable"), and phone photos arrive at 7000+ px, which resvg rasterises slowly and with a large memory cost inside a lambda.
  - **Free fixes:** re-encoding through `createImageBitmap` also applies EXIF orientation, and strips EXIF metadata such as location.
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
- **Presign:** `POST /api/uploads/presign` with `kind: "design-image"` returns `{ url, key }`, the same shape as the other kinds.

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
