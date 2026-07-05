# Batch 3 — Amazon Bedrock AI Provider — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add Amazon Bedrock as a selectable AI provider in the existing provider-agnostic layer, so chat/strategy/calendar (and later the brand suggest button) can run on Bedrock via env config — with **no credentials hardcoded**; the user supplies AWS region/keys/model id at deploy time.

**Architecture:** The app already resolves models through `getModel(feature)` (`src/lib/ai/provider.ts`) driven by `resolveProviderConfig` (`src/lib/ai/provider-config.ts`). Bedrock is added as one more `case` in that switch plus the config maps. Because Bedrock authenticates with AWS credentials (not a single API key), `DEFAULT_MODELS.bedrock` stays empty (an explicit model id is required) and the deploy preflight does a credential-presence check rather than an HTTP `/models` ping.

**Tech Stack:** Vercel AI SDK v6 (`ai@6`, `@ai-sdk/*@3.x` generation), `@ai-sdk/amazon-bedrock`, Vitest, Biome.

## Global Constraints

- Test runner: `npm test`. Single file: `npx vitest run <path>`. Lint: `npm run lint` (Biome). Typecheck: `npx tsc --noEmit -p tsconfig.json` MUST be clean before every commit.
- Repo-wide lint has ~36 PRE-EXISTING errors in untouched files; only touched files must be clean.
- **Dependency version is load-bearing:** install EXACTLY `@ai-sdk/amazon-bedrock@4.0.128`. This project is the `@ai-sdk/provider@3.0.x` / `provider-utils@4.0.x` generation (matching `@ai-sdk/anthropic@3.0.85`, `ai@6`). Bedrock `4.0.128` depends on `@ai-sdk/provider@3.0.13` + `provider-utils@4.0.35` — compatible. Do NOT install `@latest` (5.x needs provider@4/utils@5 and would duplicate `@ai-sdk/provider`, breaking the build). Pin exact (no `^`), matching the exact-pin style of `@ai-sdk/anthropic`/`@ai-sdk/google` in package.json.
- **Nothing hardcoded:** no AWS region, key, secret, or model id in source. `DEFAULT_MODELS.bedrock = ""`. Real values come from env at deploy.
- Bedrock auth env vars (consumed only at request time via `requireEnv`): `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and optional `AWS_SESSION_TOKEN`.
- `provider.ts` switch ends in `default: ... provider satisfies never` (exhaustiveness). Adding `"bedrock"` to the `AiProvider` union REQUIRES the matching case in the SAME change, or tsc fails — Task 1 does both together.
- `PROVIDER_KEY_ENV` and `DEFAULT_MODELS` are `Record<AiProvider, string>`; adding `"bedrock"` to the union requires an entry in BOTH maps or tsc fails.

---

### Task 1: Add the Bedrock provider (dependency + config + provider case)

Everything that must move together to stay tsc-clean: the dependency, the config union/maps, the `getModel` case, and the config test.

**Files:**
- Modify: `package.json` + `package-lock.json` (new dependency)
- Modify: `src/lib/ai/provider-config.ts`
- Modify: `src/lib/ai/provider.ts`
- Test: `src/lib/ai/provider-config.test.ts` (add a bedrock case)

**Interfaces:**
- Produces: `AiProvider` union now includes `"bedrock"`; `getModel("chat")` resolves a Bedrock `LanguageModel` when `AI_PROVIDER=bedrock`.

- [ ] **Step 1: Install the exact-pinned dependency**

Run:
```bash
npm install --save-exact @ai-sdk/amazon-bedrock@4.0.128
```
Expected: adds `"@ai-sdk/amazon-bedrock": "4.0.128"` to `dependencies` (no caret). Confirm afterward that `node_modules/@ai-sdk/provider/package.json` is still `3.0.x` (not upgraded to 4.x) — if npm hoisted a `provider@4`, STOP and report (wrong bedrock version).

- [ ] **Step 2: Write the failing config test**

Add these cases to `src/lib/ai/provider-config.test.ts` (inside the existing `describe`):

```ts
  it("returns an empty model for bedrock (must be set explicitly)", () => {
    expect(
      resolveProviderConfig("chat", { AI_PROVIDER: "bedrock" }),
    ).toEqual({ provider: "bedrock", model: "" });
  });

  it("honors an explicit model for bedrock", () => {
    const env = {
      AI_PROVIDER: "bedrock",
      AI_MODEL: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    };
    expect(resolveProviderConfig("chat", env)).toEqual({
      provider: "bedrock",
      model: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    });
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/ai/provider-config.test.ts`
Expected: FAIL — `"bedrock"` is not an `AiProvider`, and `DEFAULT_MODELS.bedrock` is `undefined` so the first case yields `model: ""` via the `?? ""` fallback but TypeScript will already error on the string literal; the run fails to compile/execute for the new cases. (If it compiles, the assertions still fail because bedrock isn't wired.)

- [ ] **Step 4: Extend `provider-config.ts`**

In `src/lib/ai/provider-config.ts`:

1. Add to the union:
```ts
export type AiProvider =
  | "zai"
  | "openai"
  | "anthropic"
  | "google"
  | "bedrock"
  | "openai-compatible";
```
2. Add to `AI_PROVIDERS`:
```ts
export const AI_PROVIDERS: readonly AiProvider[] = [
  "zai",
  "openai",
  "anthropic",
  "google",
  "bedrock",
  "openai-compatible",
];
```
3. Add to `DEFAULT_MODELS` (empty — no safe universal default; the exact Bedrock model id / inference profile must be set via env):
```ts
  bedrock: "",
```
4. Add to `PROVIDER_KEY_ENV` (representative primary credential — Bedrock actually needs region+key+secret, handled in provider.ts; this entry only satisfies the `Record` type):
```ts
  bedrock: "AWS_ACCESS_KEY_ID",
```

- [ ] **Step 5: Add the `bedrock` case to `provider.ts`**

In `src/lib/ai/provider.ts`, add the import (Biome-ordered) and the case:

```ts
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
```

```ts
    case "bedrock":
      return createAmazonBedrock({
        region: requireEnv("AWS_REGION"),
        accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
        ...(process.env.AWS_SESSION_TOKEN
          ? { sessionToken: process.env.AWS_SESSION_TOKEN }
          : {}),
      })(model);
```

Place it alongside the other cases (before `default:`). The `default: ... satisfies never` must now compile because the union is fully handled.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run src/lib/ai/provider-config.test.ts`
Expected: PASS (existing cases + the two new bedrock cases).

- [ ] **Step 7: Full verify + commit**

Run: `npm test` → full suite green.
Run: `npx tsc --noEmit -p tsconfig.json` → clean (confirms `createAmazonBedrock`'s options + returned model type are compatible with `getModel`'s `LanguageModel` return and `ai@6`).
Run: `npm run lint` → touched files clean.

```bash
git add package.json package-lock.json src/lib/ai/provider-config.ts src/lib/ai/provider.ts src/lib/ai/provider-config.test.ts
git commit -m "feat(ai): add Amazon Bedrock as a selectable provider"
```

---

### Task 2: Deploy preflight handles Bedrock

`scripts/check-env.mjs` pings each provider's `/models` with a single API key — Bedrock has neither. Add a credential-presence check so a Bedrock deploy is gated on AWS vars being set, and so the "no model configured" gate still fires when the model id is missing.

**Files:**
- Modify: `scripts/check-env.mjs`

**Interfaces:** none exported (build-time script).

- [ ] **Step 1: Add bedrock to the script's `DEFAULT_MODELS`**

In `scripts/check-env.mjs`, extend the local `DEFAULT_MODELS` map (near line 46) with:
```js
  bedrock: "",
```
This keeps `resolveProvider` returning `model: ""` for bedrock when unset, so the existing `if (!f.model)` gate correctly flags a missing Bedrock model id.

- [ ] **Step 2: Handle bedrock in `pingProvider`**

In `pingProvider(provider)` (near line 124), BEFORE the existing `const key = process.env[KEY_ENV[provider]]` line, add a Bedrock branch that checks AWS credential presence instead of an API-key ping (a real Bedrock call needs SigV4 signing, out of scope for a presence check):

```js
  if (provider === "bedrock") {
    const required = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      return { status: "fail", detail: `missing ${missing.join(", ")}` };
    }
    return { status: "ok", detail: "AWS credentials present (ping skipped)" };
  }
```

Leave the rest of `pingProvider` unchanged (the `KEY_ENV[provider]` lookup below is never reached for bedrock).

- [ ] **Step 3: Verify the script parses and the bedrock path behaves**

Run (syntax + bedrock-missing-creds path, DB/R2 skipped, AI ping only):
```bash
SKIP_DB_CHECK=1 SKIP_R2_CHECK=1 AI_PROVIDER=bedrock AI_MODEL=test-model node scripts/check-env.mjs; echo "exit=$?"
```
Expected: the AI section prints `AI[bedrock]: missing AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY` and preflight FAILS (exit 1) — proving the gate works when creds are absent.

Then run with fake creds present to confirm the ok-path:
```bash
SKIP_DB_CHECK=1 SKIP_R2_CHECK=1 AI_PROVIDER=bedrock AI_MODEL=test-model AWS_REGION=us-east-1 AWS_ACCESS_KEY_ID=AKIA_test AWS_SECRET_ACCESS_KEY=secret_test node scripts/check-env.mjs; echo "exit=$?"
```
Expected: AI section prints `AI[bedrock]: AWS credentials present (ping skipped)` and there is NO `ai` failure from the AI check. (Overall exit may still be non-zero from other gates if any run, but the AI line must show ok — capture it.)

Run: `npm run lint` → `check-env.mjs` clean.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-env.mjs
git commit -m "chore(preflight): gate Bedrock deploys on AWS credential presence"
```

---

### Task 3: Document the Bedrock env vars

Make the required credentials discoverable in `.env.example`.

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Add a commented Bedrock section**

In `.env.example`, near the existing AI provider settings (the `AI_PROVIDER` / `AI_MODEL` block), add:

```bash
# ── Amazon Bedrock (optional AI provider) ─────────────────────────────
# To route AI through Amazon Bedrock, set AI_PROVIDER=bedrock (or a per-feature
# override like AI_CHAT_PROVIDER=bedrock) and provide the exact model id /
# inference-profile id enabled in your AWS account (there is NO default):
#   AI_PROVIDER=bedrock
#   AI_MODEL=us.anthropic.claude-sonnet-4-5-20250929-v1:0   # example — use YOUR enabled model
# Bedrock authenticates with AWS credentials (not an API key):
#   AWS_REGION=us-east-1
#   AWS_ACCESS_KEY_ID=...
#   AWS_SECRET_ACCESS_KEY=...
#   AWS_SESSION_TOKEN=...        # optional, only for temporary STS credentials
# The IAM principal needs bedrock:InvokeModel + bedrock:InvokeModelWithResponseStream,
# and the model must be enabled in the Bedrock console (Model access) in that region.
```

- [ ] **Step 2: Verify + commit**

Run: `npm run lint` → `.env.example` is not linted by Biome (config/markdown-ish); if Biome ignores it, no action. Confirm no accidental real secret was added.

```bash
git add .env.example
git commit -m "docs(env): document Amazon Bedrock credentials + model config"
```

---

## Self-Review

**Spec coverage (#4):**
- Bedrock added as an ADDITIVE selectable provider (Google/Anthropic/etc. still work) → Task 1. ✓
- Env-driven, nothing hardcoded (empty default model; creds from env) → Tasks 1 & 3. ✓
- Preflight understands Bedrock (no false API-key failure; gates on AWS creds) → Task 2. ✓
- Credentials documented for the user to supply at deploy → Task 3. ✓

**Placeholder scan:** No vague steps. The one non-source default (`AI_MODEL` example in `.env.example`) is explicitly labeled "example — use YOUR enabled model" and is a comment, not shipped config.

**Type consistency:** `"bedrock"` added to `AiProvider`, `AI_PROVIDERS`, `DEFAULT_MODELS`, `PROVIDER_KEY_ENV` (Task 1 Step 4) — all four required by the `Record<AiProvider, string>` types and the exhaustive switch. `createAmazonBedrock` import + case (Step 5) satisfies the `satisfies never` guard. Config test (Step 2) matches the union change.

**Deploy note (not code — for the user's runbook):** to actually USE Bedrock, set `AI_PROVIDER=bedrock` (or per-feature), `AI_MODEL=<your enabled model/inference-profile id>`, and `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in the deployment env; enable the model in the Bedrock console and grant `bedrock:InvokeModel*` to the IAM principal. Some newer Claude-on-Bedrock models require a region-prefixed inference profile id (e.g. `us.anthropic.…`) rather than the bare model id.

**Known non-goal:** no live Bedrock invocation is exercised in tests (needs real AWS creds + an enabled model). Task 1 proves type-compatibility and resolution; the live smoke test is a deploy-time step in the runbook above.
