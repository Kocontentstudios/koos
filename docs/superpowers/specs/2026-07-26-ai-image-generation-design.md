# Epic 2 — AI Design/Image Generation (Design Spec)

Status: Draft for review · Date: 2026-07-26 · Owner: engineering
Parent program: `.claude/plans/squishy-mapping-pixel.md`

## 1. Purpose

Let users generate design images on-platform, brand-aware, from within the **design-request
flow**. A user composing a design request can generate a draft image (prompt seeded from their
brand data), preview it, and then **download it**, **save it as a brand asset**, and/or
**attach it to the design request as a reference** for the design team. Covers original
request **#2**.

Non-goals: replacing the human design team (generated images are drafts/references), video/3D,
in-image editing (inpaint/outpaint) — a possible later phase.

## 2. Locked decisions (from the user)

- **Placement:** inside the **design-request flow** (not a standalone page, not a chat tool).
- **Outputs (all three):** download only · save as a **brand asset** · attach to a **design
  ticket** as a reference.
- **Model:** default **Bedrock**, fully **env-pluggable** (mirror the text `provider-config`
  pattern), default to Bedrock when unset.
- **Cost:** image generation is metered per image — state it in UI + spec.

## 3. Research outcome — default model choice

Investigated Bedrock image models (July 2026):
- **Amazon Nova Canvas** (`amazon.nova-canvas-v1:0`) — the AI SDK's cleanest documented
  `bedrock.imageModel()` path and available in us-east-1, BUT **Legacy, EOL 2026-09-30** in
  us-east-1. Poor long-term default.
- **Amazon Titan Image Generator v2** (`amazon.titan-image-generator-v2:0`) — also **Legacy**.
- **Stability AI Stable Image suite** — **Active**, Bedrock-native successors:
  `stability.stable-image-core-v1:1` (fast, ~$0.03–0.04/img), `stability.stable-image-ultra-v1:1`
  (ultra quality), `stability.sd3-5-large-v1:0` (~$0.08/img). Primarily **us-west-2**.

**Decision:** default to **Stable Image Core** (`stability.stable-image-core-v1:1`) — active,
cheapest, fast, well-suited to social/design drafts — with **Stable Image Ultra** as the
quality override, all behind a pluggable `getImageModel()` so the model is one env var to
change. Because Stability image models are us-west-2-first while the app's text models run
us-east-1 (see [[bedrock-production-config]]), Epic 2 introduces a separate **`AI_IMAGE_REGION`**
(default `us-west-2`).

**Build-time verification required (Task-0 spike):** confirm `@ai-sdk/amazon-bedrock`'s
`bedrock.imageModel()` + `experimental_generateImage` cleanly supports the Stability model
IDs in `AI_IMAGE_REGION`. The AI SDK documents Nova Canvas support explicitly; Stability-on-
Bedrock support is less certain (see vercel/ai#4942). **Fallback if the SDK path is not
clean:** call Bedrock `InvokeModel` directly (the app already holds AWS SigV4 creds) with the
Stability request/response schema, behind the same `getImageModel()` interface. If neither is
viable in time, the pluggable design lets us ship on Nova Canvas short-term (flagged EOL) and
swap later via env — no code change.

## 4. Current-state anchors (reuse, don't rebuild)

- Text provider abstraction: `src/lib/ai/provider.ts` (`getModel`), `provider-config.ts`
  (`resolveProviderConfig`, `AiProvider`, env override shape). Image config mirrors this.
- Storage (Cloudflare R2): `src/lib/storage.ts` — `uploadObject({key, body, contentType})`,
  `publicUrl(key)`, `getSignedReadUrl(key, ttl)`, `isStorageConfigured()`, `STORAGE_PREFIXES`.
- Brand assets: `brand_assets` table (`assetType` enum incl. `"image"`); read via
  `getBrandAssets(brandId)` (added in Epic 3).
- Design-request flow: `src/lib/design/quick-request.ts` already threads an optional
  **`referenceImageUrl`** into the brief (lines ~16/44/66) — this is the attach-to-ticket hook.
  Quick form: `src/app/(dashboard)/design-request/quick/*`. Ticket create:
  `src/lib/design/ticket-create.ts` (Epic 3).
- Access guard: `checkBrandAccess(userId, brandId, "manage_content")`.
- Rate limit: `checkRateLimit` / `tooManyRequests`. Usage: `recordUsageEvent`.
- Bedrock cap lesson: always set output/size limits ([[bedrock-output-token-cap]]).

## 5. Architecture

```
Design-request UI ──▶ POST /api/design/generate-image { brandId, prompt?, style?, size? }
                          │  auth · rate-limit · checkBrandAccess · verified-email
                          │  compose brand-aware prompt (brand tone/colors/style + user prompt)
                          ▼
                   getImageModel() ──experimental_generateImage / InvokeModel──▶ Bedrock (Stability)
                          │  bytes
                          ▼
                   uploadObject(generated/<brand>/<uuid>.png)  → returns { url, key }
                          ▼
        UI shows preview + 3 actions:
          • Download        → signed URL / direct download
          • Save as asset   → POST /api/design/generated/save-asset  → brand_assets row
          • Attach to ticket→ set as referenceImageUrl on the design request being composed
```

Every generated image is written to R2 immediately (so preview + all actions have a stable
URL); persistence into `brand_assets` happens only on explicit "save as asset". Attach-to-
ticket sets the request's `referenceImageUrl`.

## 6. Components

### 6.1 Image provider abstraction
- `src/lib/ai/image-provider-config.ts` (or extend `provider-config.ts`): `resolveImageConfig(env)`
  → `{ provider, model, region }` from `AI_IMAGE_PROVIDER` (default `bedrock`), `AI_IMAGE_MODEL`
  (default `stability.stable-image-core-v1:1`), `AI_IMAGE_REGION` (default `us-west-2`).
- `getImageModel()` in `src/lib/ai/image.ts`: returns a `generateBrandImage({ prompt, size?,
  style? }): Promise<{ bytes: Uint8Array; contentType: string }>` — internally uses
  `experimental_generateImage` with `bedrock.imageModel(model)` (region-scoped provider), OR the
  direct-`InvokeModel` fallback (Task-0 decides). Enforces a max size / count.

### 6.2 Brand-aware prompt composition
- `src/lib/ai/prompts/image.ts` — `buildImagePrompt({ brand, userPrompt, style })`: weaves the
  brand's tone, colors (primary/secondary), brandStyle, and offer into a concise image prompt.
  Reuses brand data via existing queries. Never fabricates; user prompt is the lead.

### 6.3 Generate endpoint
- `POST /api/design/generate-image`: auth → rate-limit (`image-generate:${userId}`, tight, e.g.
  10/hour — metered spend) → body validation (brandId uuid, prompt capped, optional style/size)
  → `checkBrandAccess` → `requireVerifiedEmail` (spends money) → compose prompt →
  `generateBrandImage` → `uploadObject(generated/…)` → `recordUsageEvent` → return
  `{ url, key, contentType }`. Model/storage failures return clean JSON errors (no throw).
  `maxDuration` headroom for the model call.

### 6.4 Save-as-asset endpoint
- `POST /api/design/generated/save-asset` `{ brandId, key, fileName }`: auth + `checkBrandAccess`
  → verify the key is under `generated/<brandId>/` (no arbitrary-key injection) → insert
  `brand_assets { brandId, assetType: "image", fileUrl, fileName }` via a new
  `addBrandAsset(...)` query → return the asset.

### 6.5 Attach-to-ticket
- No new table: the generated image URL becomes the design request's `referenceImageUrl`
  (already supported by `quick-request.ts`). The UI sets it on the in-progress request; on
  submit it flows into the brief exactly as an uploaded reference does today.

### 6.6 UI (inside design-request flow)
- A **"Generate with AI"** panel in the quick-request form (`design-request/quick/*`): a prompt
  box (pre-fillable from the brief), an optional style/size control, a **Generate** button
  (loading state), a preview of the result, and three actions — **Download**, **Save as brand
  asset**, **Use as reference** (sets `referenceImageUrl`). Reuses `Button`/`sonner`/tokens.
- Copy states the per-image cost and that this is a draft/reference for the design team.

## 7. New storage prefix
Add `generated: "generated"` to `STORAGE_PREFIXES`. Generated objects keyed
`generated/<brandId>/<uuid>.<ext>`. Served via `publicUrl` if a public base is configured,
else `getSignedReadUrl`.

## 8. Provider-config / env summary
`AI_IMAGE_PROVIDER` (default `bedrock`) · `AI_IMAGE_MODEL` (default
`stability.stable-image-core-v1:1`) · `AI_IMAGE_REGION` (default `us-west-2`). Reuses existing
AWS SigV4 creds. Documented in the env sample.

## 9. Error handling & security
- Access + verified-email + rate-limit gate BEFORE any model spend.
- Save-as-asset validates the R2 key is under the caller's `generated/<brandId>/` prefix (no
  cross-brand or arbitrary-object save).
- All model/storage failures return typed JSON errors; nothing throws to the client.
- If storage or the image provider is unconfigured, the feature degrades gracefully (the panel
  shows a disabled state with a clear message) rather than 500-ing.
- Generated images are drafts — UI must not imply they are final brand-approved assets.

## 10. Testing
- Unit: `resolveImageConfig` defaults + env overrides; `buildImagePrompt` weaves brand data;
  generate route order (access/verified/rate-limit before model), clean errors, key format;
  save-asset key-prefix validation (rejects a key outside `generated/<brandId>/`).
- Mock the image model + storage in route tests (no real Bedrock/R2 in unit tests).
- Live QA (needs Bedrock image access in `AI_IMAGE_REGION` + R2): generate → preview →
  each of the three outputs; confirm a saved asset appears in the brand's assets and an
  attached image flows into the submitted brief.

## 11. Phasing
1. **2-0 (spike):** verify AI SDK Stability-on-Bedrock support vs. direct `InvokeModel`; lock the
   `getImageModel()` internals. (Small, decides the rest.)
2. **2-A:** image provider config + `getImageModel`/`generateBrandImage` + prompt composition.
3. **2-B:** generate endpoint + storage write.
4. **2-C:** save-as-asset endpoint (+ `addBrandAsset` query) + attach-to-ticket wiring.
5. **2-D:** the "Generate with AI" UI panel in the design-request flow.

## 12. Open items to confirm during build
- Final default model pending the Task-0 spike (Stable Image Core assumed; may fall back to
  Nova Canvas short-term if SDK/region friction, flagged EOL).
- Whether to also expose the panel on the design-request **chat** surface, or quick-form only
  (start: quick-form; chat can follow).
- Number of variations per generate (start: 1, to control cost).
