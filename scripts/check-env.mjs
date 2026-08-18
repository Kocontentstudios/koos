/**
 * Build/deploy preflight. Runs before `next build` (see package.json "build").
 *
 * HARD-GATES the deploy on the integrations the app cannot run without:
 *   - Database     : connectivity + schema initialized
 *   - AI provider  : the configured provider's API key is present and valid
 *   - Cloudflare R2 : credentials present + bucket reachable (HeadBucket)
 *   - Public env   : no NEXT_PUBLIC_* variable set that the code never reads
 * Google OAuth is checked as a WARNING (presence only) — sign-in still works
 * with email/password if it's absent.
 *
 * A failed hard-gate exits non-zero, which fails the build and the deploy.
 *
 * Escape hatches (use sparingly, e.g. offline CI):
 *   SKIP_PREFLIGHT=1   bypass everything
 *   SKIP_DB_CHECK=1    SKIP_AI_CHECK=1   SKIP_R2_CHECK=1   AI_SKIP_PING=1
 *   SKIP_PUBLIC_ENV_CHECK=1
 */

import postgres from "postgres";
import {
  describeOrphan,
  findMissing,
  findOrphans,
  readReferencedNames,
} from "./public-env-guard.mjs";

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}⚠${C.reset} ${m}`);
const bad = (m) => console.log(`${C.red}✗${C.reset} ${m}`);

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env (CI / Vercel)
}

if (process.env.SKIP_PREFLIGHT === "1") {
  console.log(`${C.dim}↷ Preflight skipped (SKIP_PREFLIGHT=1).${C.reset}`);
  process.exit(0);
}

const failures = [];

// ── helpers ──────────────────────────────────────────────────────────

const DEFAULT_MODELS = {
  zai: "glm-4.6",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-5",
  google: "gemini-2.5-flash",
  "openai-compatible": "",
  bedrock: "",
};
const KEY_ENV = {
  zai: "ZAI_API_KEY",
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  "openai-compatible": "AI_COMPATIBLE_API_KEY",
};

function isVertexConfigured() {
  return Boolean(
    process.env.GOOGLE_VERTEX_PROJECT &&
      process.env.GOOGLE_CLIENT_EMAIL &&
      process.env.GOOGLE_PRIVATE_KEY,
  );
}

function resolveProvider(feature) {
  const F = feature.toUpperCase();
  const global = process.env.AI_PROVIDER || "google";
  const provider = process.env[`AI_${F}_PROVIDER`] || global;
  let model = process.env[`AI_${F}_MODEL`] || "";
  if (!model && provider === global) model = process.env.AI_MODEL || "";
  if (!model) model = DEFAULT_MODELS[provider] ?? "";
  return { provider, model };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

// ── Database ─────────────────────────────────────────────────────────

async function checkDb() {
  if (process.env.SKIP_DB_CHECK === "1") return warn("DB check skipped.");
  const url = process.env.DATABASE_URL;
  if (!url) {
    bad("DB: DATABASE_URL is not set.");
    failures.push("database");
    return;
  }
  const sql = postgres(url, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 3,
  });
  try {
    await sql`select 1`;
    const [{ initialized }] = await sql`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'users'
      ) as initialized`;
    if (!initialized) {
      bad(
        'DB: connected, but the "users" table is missing (run pnpm db:push).',
      );
      failures.push("database");
    } else {
      ok("DB: reachable and schema initialized.");
    }
  } catch (e) {
    bad(`DB: ${e.message}`);
    failures.push("database");
  } finally {
    await sql.end({ timeout: 3 }).catch(() => {});
  }
}

// ── AI provider ──────────────────────────────────────────────────────

async function pingProvider(provider) {
  if (provider === "bedrock") {
    const required = [
      "AWS_REGION",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
    ];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) {
      return { status: "fail", detail: `missing ${missing.join(", ")}` };
    }
    return { status: "ok", detail: "AWS credentials present (ping skipped)" };
  }

  // Google has two credential shapes. Vertex is preferred because only that
  // surface draws the Google Cloud trial credit, and it uses a service account
  // rather than an API key, so there is no key to ping.
  if (provider === "google" && isVertexConfigured()) {
    const location = process.env.GOOGLE_VERTEX_LOCATION || "global";
    if (location !== "global") {
      return {
        status: "warn",
        detail: `Vertex location "${location}" — the Gemini 3 line only serves from "global"`,
      };
    }
    return {
      status: "ok",
      detail: `Vertex service account on ${process.env.GOOGLE_VERTEX_PROJECT} (ping skipped)`,
    };
  }

  const key = process.env[KEY_ENV[provider]];
  if (!key) return { status: "fail", detail: `${KEY_ENV[provider]} not set` };
  if (process.env.AI_SKIP_PING === "1") {
    return { status: "ok", detail: "key present (ping skipped)" };
  }

  let url;
  let headers;
  if (provider === "openai") {
    url = "https://api.openai.com/v1/models";
    headers = { Authorization: `Bearer ${key}` };
  } else if (provider === "anthropic") {
    url = "https://api.anthropic.com/v1/models";
    headers = { "x-api-key": key, "anthropic-version": "2023-06-01" };
  } else if (provider === "google") {
    url = `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`;
    headers = {};
  } else {
    const base =
      provider === "zai"
        ? "https://api.z.ai/api/paas/v4"
        : process.env.AI_COMPATIBLE_BASE_URL;
    if (!base)
      return { status: "fail", detail: "AI_COMPATIBLE_BASE_URL not set" };
    url = `${base.replace(/\/$/, "")}/models`;
    headers = { Authorization: `Bearer ${key}` };
  }

  try {
    const res = await withTimeout(fetch(url, { headers }), 12_000, "AI ping");
    if (res.ok)
      return { status: "ok", detail: `validated (HTTP ${res.status})` };
    if (res.status === 401 || res.status === 403) {
      return { status: "fail", detail: `invalid key (HTTP ${res.status})` };
    }
    // Endpoint quirk (e.g. no /models on a gateway) — key present, can't verify.
    return {
      status: "warn",
      detail: `key present but /models returned HTTP ${res.status}`,
    };
  } catch (e) {
    return { status: "warn", detail: `key present, ping failed: ${e.message}` };
  }
}

async function checkAi() {
  if (process.env.SKIP_AI_CHECK === "1") return warn("AI check skipped.");
  const chat = resolveProvider("chat");
  const strategy = resolveProvider("strategy");
  const providers = [...new Set([chat.provider, strategy.provider])];

  console.log(
    `${C.dim}  AI: chat=${chat.provider}/${chat.model || "?"} ` +
      `strategy=${strategy.provider}/${strategy.model || "?"}${C.reset}`,
  );

  for (const f of [chat, strategy]) {
    if (!f.model) {
      bad(`AI: no model configured for "${f.provider}" (set AI_MODEL).`);
      failures.push("ai");
    }
  }

  for (const provider of providers) {
    const r = await pingProvider(provider);
    if (r.status === "ok") ok(`AI[${provider}]: ${r.detail}`);
    else if (r.status === "warn") warn(`AI[${provider}]: ${r.detail}`);
    else {
      bad(`AI[${provider}]: ${r.detail}`);
      failures.push("ai");
    }
  }
}

// ── Cloudflare R2 ────────────────────────────────────────────────────

async function checkR2() {
  if (process.env.SKIP_R2_CHECK === "1") return warn("R2 check skipped.");
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    bad(`R2: missing ${missing.join(", ")}.`);
    failures.push("r2");
    return;
  }
  const pub = process.env.R2_PUBLIC_BASE_URL;
  if (!pub) {
    warn("R2: R2_PUBLIC_BASE_URL not set — uploaded logos won't render.");
  } else if (/\.r2\.cloudflarestorage\.com\/?$/i.test(pub)) {
    bad(
      "R2: R2_PUBLIC_BASE_URL points at the private S3 API endpoint " +
        "(*.r2.cloudflarestorage.com), which is NOT publicly servable — stored " +
        "logo URLs would 400. Use the bucket's public r2.dev URL or a custom domain.",
    );
    failures.push("r2");
  }

  try {
    const { S3Client, HeadBucketCommand } = await import("@aws-sdk/client-s3");
    const client = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
    await withTimeout(
      client.send(new HeadBucketCommand({ Bucket: process.env.R2_BUCKET })),
      12_000,
      "R2 HeadBucket",
    );
    ok(`R2: bucket "${process.env.R2_BUCKET}" reachable.`);
  } catch (e) {
    bad(`R2: ${e.message}`);
    failures.push("r2");
  }
}

// ── Google OAuth (warning only) ──────────────────────────────────────

function checkGoogle() {
  const id = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (id && secret) ok("Google OAuth: credentials present.");
  else warn("Google OAuth: not configured — 'Sign in with Google' disabled.");
}

// ── SMTP / Zoho Mail (warning only) ──────────────────────────────────

function checkSmtp() {
  const missing = ["ZOHO_SMTP_USER", "ZOHO_SMTP_PASS"].filter(
    (k) => !process.env[k],
  );
  if (missing.length) {
    warn(
      `SMTP: missing ${missing.join(", ")} — ALL email (contact form, ` +
        "password reset, welcome, design tickets) will fail. " +
        "Run `node scripts/check-smtp.mjs` to diagnose.",
    );
    return;
  }
  const from = process.env.ZOHO_MAIL_FROM;
  const user = process.env.ZOHO_SMTP_USER;
  if (from && from !== user) {
    warn(
      `SMTP: ZOHO_MAIL_FROM (${from}) != ZOHO_SMTP_USER (${user}) — ` +
        "Zoho rejects sends unless the From address is an authorized alias.",
    );
  }
  ok("SMTP: Zoho credentials present (auth not verified at build time).");
}

// ── Public env (NEXT_PUBLIC_*) ───────────────────────────────────────

/* Every NEXT_PUBLIC_* reader in this app degrades to a silent no-op when its
   variable is missing, so a misspelled name deploys green and collects
   nothing. NEXT_PUBLIC_POSTHOG_PROJECT_KEY did exactly that in production. */
async function checkPublicEnv() {
  if (process.env.SKIP_PUBLIC_ENV_CHECK === "1") {
    return warn("Public env check skipped.");
  }

  const referenced = await readReferencedNames(["src", "next.config.ts"]);

  // An empty scan means the walk failed (wrong cwd), not that the app reads
  // nothing. Failing here would brick every deploy, so degrade to a warning.
  if (referenced.size === 0) {
    return warn(
      "Public env: found no NEXT_PUBLIC_* references in src/ — " +
        "scan skipped rather than flagging every variable.",
    );
  }

  const provided = new Set(Object.keys(process.env));

  for (const name of findMissing({
    referenced,
    provided,
    isProduction: process.env.VERCEL_ENV === "production",
  })) {
    warn(`Public env: ${name} is read by the app but unset in production.`);
  }

  const orphans = findOrphans({ referenced, provided });

  if (!orphans.length) {
    return ok(
      `Public env: ${referenced.size} NEXT_PUBLIC_* variables, no orphans.`,
    );
  }

  for (const orphan of orphans) {
    bad(`Public env: ${describeOrphan(orphan, referenced)}`);
  }
  failures.push("public-env");
}

// ── run ──────────────────────────────────────────────────────────────

console.log("Running deploy preflight…\n");
await checkPublicEnv();
await checkDb();
await checkAi();
await checkR2();
checkGoogle();
checkSmtp();

console.log("");
if (failures.length) {
  bad(
    `Preflight FAILED — blocking deploy: ${[...new Set(failures)].join(", ")}`,
  );
  process.exit(1);
}
ok("Preflight passed — all required integrations are connected.");
process.exit(0);
