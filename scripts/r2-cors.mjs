/**
 * R2 bucket CORS — applies the canonical AllowedOrigins list required for
 * browser-direct presigned uploads (design request attachments), then
 * verifies each origin with a live preflight against the S3 endpoint.
 *
 * Presigned PUTs go straight from the browser to
 * <bucket>.<account>.r2.cloudflarestorage.com, so every app origin must be
 * in the bucket CORS rules or the preflight 403s and the form shows a bare
 * "Upload failed". Re-run after adding a new app domain.
 *
 * Usage:
 *   node --env-file=.env scripts/r2-cors.mjs           # apply + verify
 *   node --env-file=.env scripts/r2-cors.mjs --check   # verify only
 */

import {
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";

const APP_ORIGINS = [
  "http://localhost:3000",
  "https://*.vercel.app",
  "https://app.kocontentstudios.com",
  "https://staging.kocontentstudios.com",
  "https://kocontentstudios.com",
];

const CORS_RULES = [
  {
    AllowedMethods: ["PUT", "GET"],
    AllowedOrigins: APP_ORIGINS,
    AllowedHeaders: ["content-type"],
    MaxAgeSeconds: 3600,
  },
];

const C = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  dim: "\x1b[2m",
};
const ok = (m) => console.log(`${C.green}✓${C.reset} ${m}`);
const fail = (m) => console.log(`${C.red}✗${C.reset} ${m}`);
const info = (m) => console.log(`${C.dim}${m}${C.reset}`);

const required = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const bucket = process.env.R2_BUCKET;
const endpoint = `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
const client = new S3Client({
  region: "auto",
  endpoint,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const checkOnly = process.argv.includes("--check");

async function showCurrentRules() {
  try {
    const res = await client.send(new GetBucketCorsCommand({ Bucket: bucket }));
    info(
      `Current AllowedOrigins: ${res.CORSRules?.flatMap((r) => r.AllowedOrigins ?? []).join(", ")}`,
    );
  } catch (err) {
    if (err?.Code === "NoSuchCORSConfiguration") {
      info("Bucket has no CORS configuration yet.");
    } else {
      throw err;
    }
  }
}

/** Wildcard origins can't be sent as a preflight Origin header; probe a
 * concrete representative instead. */
function probeOrigin(origin) {
  return origin.replace("*.", "koos-preflight-probe.");
}

async function verifyPreflight() {
  let allPassed = true;
  for (const origin of APP_ORIGINS) {
    const probe = probeOrigin(origin);
    const res = await fetch(
      `${endpoint.replace("://", `://${bucket}.`)}/probe`,
      {
        method: "OPTIONS",
        headers: {
          Origin: probe,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": "content-type",
        },
      },
    );
    if (res.status === 204 || res.status === 200) {
      ok(`Preflight allowed: ${probe}`);
    } else {
      fail(`Preflight rejected (${res.status}): ${probe}`);
      allPassed = false;
    }
  }
  return allPassed;
}

await showCurrentRules();
if (!checkOnly) {
  await client.send(
    new PutBucketCorsCommand({
      Bucket: bucket,
      CORSConfiguration: { CORSRules: CORS_RULES },
    }),
  );
  ok(`Applied canonical CORS rules to bucket "${bucket}".`);
}
const passed = await verifyPreflight();
process.exit(passed ? 0 : 1);
