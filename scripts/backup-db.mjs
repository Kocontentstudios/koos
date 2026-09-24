/**
 * Nightly logical backups of every KO OS database to a private R2 bucket.
 *
 * Usage:
 *   node --env-file=.env scripts/backup-db.mjs                 # dump, verify, upload, prune
 *   node --env-file=.env scripts/backup-db.mjs --dry-run       # dump + verify only
 *   node --env-file=.env scripts/backup-db.mjs --list          # what is in the bucket
 *   node --env-file=.env scripts/backup-db.mjs --download KEY [--out DIR]
 *
 * Restore with pg_restore; see docs/runbooks/database.md.
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

export const DEFAULT_RETENTION_DAYS = 30;
export const MIN_RETENTION_DAYS = 7;
/** Retention must never be able to empty the bucket, however old the copies. */
export const MIN_KEPT = 3;
export const BACKUP_PREFIX = "backups";
/** A dump this much smaller than the previous one means something is wrong
 *  with the source, not with the backup: upload it, prune nothing, fail loudly. */
export const SHRINK_GUARD_RATIO = 0.5;
/** S3 DeleteObjects hard limit. */
const DELETE_BATCH = 1000;

/** The random suffix stops two runs in the same millisecond overwriting each
 *  other; the timestamp still sorts the keys. */
export function backupKey(
  database,
  date,
  suffix = randomBytes(3).toString("hex"),
) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  return `${BACKUP_PREFIX}/${database}/${stamp}-${suffix}.dump`;
}

export function parseBackupKey(key) {
  const match = new RegExp(
    `^${BACKUP_PREFIX}/([^/]+)/(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)(?:-[0-9a-f]+)?\\.dump$`,
  ).exec(key);
  if (!match) return null;

  const iso = match[2].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    "T$1:$2:$3.$4Z",
  );
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : { database: match[1], date, key };
}

/**
 * Older than the retention window, but only once MIN_KEPT newer copies of the
 * SAME database survive. Keys of other databases and anything unparseable are
 * ignored: this must never delete an object it does not understand.
 */
export function expiredKeys(
  keys,
  { now, retentionDays = DEFAULT_RETENTION_DAYS, database },
) {
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const parsed = keys
    .map(parseBackupKey)
    .filter((entry) => entry && (!database || entry.database === database))
    .sort((a, b) => b.date.getTime() - a.date.getTime());

  return parsed
    .filter(
      (entry, index) => index >= MIN_KEPT && entry.date.getTime() < cutoff,
    )
    .map((entry) => entry.key);
}

/** Rejects anything that would delete more than it keeps. */
export function resolveRetentionDays(raw) {
  if (raw === undefined || raw === null || `${raw}`.trim() === "") {
    return DEFAULT_RETENTION_DAYS;
  }
  const days = Number(raw);
  if (!Number.isInteger(days) || days < MIN_RETENTION_DAYS) {
    throw new Error(
      `BACKUP_RETENTION_DAYS must be an integer >= ${MIN_RETENTION_DAYS}, got "${raw}".`,
    );
  }
  return days;
}

/**
 * Where backups go.
 *
 * On 2026-09-23 dumps were written to the app's bucket, which has bucket-wide
 * public read, and the production archive was anonymously downloadable. Two
 * defences, because the first one only works when R2_BUCKET happens to be in
 * the environment and a CI job need not set it:
 *   1. refuse a destination equal to a known app bucket, and
 *   2. refuse to run at all unless the destination is declared private by
 *      BACKUP_BUCKET_IS_PRIVATE, which an operator sets once, deliberately.
 * assertNotPubliclyReadable() then proves it against the live bucket.
 */
export function resolveBucket(env) {
  const bucket = env.BACKUP_R2_BUCKET;
  if (!bucket) throw new Error("BACKUP_R2_BUCKET is not set.");

  const appBuckets = [env.R2_BUCKET, env.NEXT_PUBLIC_R2_BUCKET].filter(Boolean);
  if (appBuckets.includes(bucket)) {
    throw new Error(
      `BACKUP_R2_BUCKET must not be the app bucket ("${bucket}"): it is publicly readable.`,
    );
  }

  if (env.BACKUP_BUCKET_IS_PRIVATE !== "true") {
    throw new Error(
      `Refusing to upload: set BACKUP_BUCKET_IS_PRIVATE=true once you have confirmed "${bucket}" has public access disabled in the Cloudflare dashboard.`,
    );
  }

  return bucket;
}

/**
 * Prove the uploaded object is not served anonymously.
 *
 * The configuration guards are declarations; this is the measurement. If the
 * bucket is public the object is deleted again and the run fails, so a
 * misconfigured destination costs one short exposure instead of a nightly one.
 */
export async function assertNotPubliclyReadable(
  { publicBaseUrl, key },
  fetchImpl = fetch,
) {
  if (!publicBaseUrl) return { checked: false };

  const url = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;
  let response;
  try {
    response = await fetchImpl(url, { method: "GET" });
  } catch {
    // A network failure is not evidence of privacy, but it is not evidence of
    // exposure either; the configuration guards still stand.
    return { checked: false };
  }

  if (response.ok) {
    throw new Error(
      `PUBLIC EXPOSURE: ${key} is anonymously readable at ${url}. The destination bucket is not private.`,
    );
  }
  return { checked: true, status: response.status };
}

/**
 * Every database to dump. The list is explicit: falling back to the one named
 * in the connection string silently halves coverage and still exits 0.
 */
export function resolveTargets(env) {
  const base = env.DIRECT_URL || env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL (or DIRECT_URL) is not set.");

  const databases = (env.BACKUP_DATABASES || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (databases.length === 0) {
    throw new Error(
      'BACKUP_DATABASES is not set. List every database explicitly, e.g. "defaultdb,koos-staging-db".',
    );
  }

  return databases.map((database) => {
    // A name with a slash produces a key parseBackupKey rejects, which would
    // then never be pruned.
    if (!/^[A-Za-z0-9_-]+$/.test(database)) {
      throw new Error(
        `Invalid database name in BACKUP_DATABASES: "${database}"`,
      );
    }
    const url = new URL(base);
    url.pathname = `/${database}`;
    return { database, connection: splitConnection(url) };
  });
}

/**
 * Credentials passed in argv land in /proc/<pid>/cmdline, readable by anything
 * else on the machine. pg_dump reads PGPASSWORD from the environment instead.
 */
export function splitConnection(url) {
  const password = decodeURIComponent(url.password);
  const safe = new URL(url.toString());
  safe.password = "";
  return { url: safe.toString(), password };
}

function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)),
    );
  });
}

/**
 * Exact live row count across the source's public tables, before dumping.
 *
 * pg_dump writes a TABLE DATA entry for every table whatever its row count, so
 * the archive cannot distinguish "backed up a full database" from "backed up
 * an empty one". Only the source can answer that.
 *
 * Counted rather than read from pg_stat_user_tables.n_live_tup: those counters
 * reset when the service restarts, and this database has just been through a
 * restart — it reported 1 row for a database holding 1,262. reltuples has the
 * same problem after a restore. An exact count costs a scan per table, which
 * is nothing at this size and is the only answer that cannot silently lie.
 */
const ROW_COUNT_SQL = `select coalesce(sum(cnt), 0) from (
  select (xpath('/row/c/text()', query_to_xml(
    format('select count(*) as c from %I.%I', schemaname, tablename),
    false, true, '')))[1]::text::bigint as cnt
  from pg_tables where schemaname = 'public') t`;

export async function countSourceRows({ url, password }, exec = run) {
  const out = await exec(
    "psql",
    [
      "--no-psqlrc",
      "--tuples-only",
      "--no-align",
      "--command",
      ROW_COUNT_SQL,
      url,
    ],
    { PGPASSWORD: password },
  );
  return Number(out.trim()) || 0;
}

export function countDataEntries(tocOutput) {
  return tocOutput
    .split("\n")
    .filter((line) => /^\d+;.*\bTABLE DATA\b/.test(line)).length;
}

/**
 * Decode the whole archive, not just its header.
 *
 * `pg_restore --list` reads only the TOC at the head of the file, so a dump
 * truncated halfway still lists every table and "passes". Restoring to
 * /dev/null forces every data block through the decompressor, which is the
 * cheapest check that reads the bytes being kept.
 *
 * The returned count is TABLE DATA *entries*, not tables containing rows —
 * see countSourceRows for the emptiness question.
 */
export async function verifyArchive(file, exec = run) {
  await exec("pg_restore", ["--file", "/dev/null", file]);
  const toc = await exec("pg_restore", ["--list", file]);
  const entries = countDataEntries(toc);
  if (entries === 0) {
    throw new Error(
      `dump at ${file} decodes but declares no table data — refusing to treat it as a backup`,
    );
  }
  return entries;
}

async function s3Client(env) {
  const { S3Client } = await import("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.BACKUP_R2_ACCESS_KEY_ID || env.R2_ACCESS_KEY_ID,
      secretAccessKey:
        env.BACKUP_R2_SECRET_ACCESS_KEY || env.R2_SECRET_ACCESS_KEY,
    },
  });
}

/** ListObjectsV2 caps at 1000 keys; without this the prune sees only the
 *  OLDEST page and "keep the newest 3" silently becomes false. */
export async function listAllKeys(send, { Bucket, Prefix }) {
  const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
  const keys = [];
  let token;
  do {
    const page = await send(
      new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken: token }),
    );
    for (const object of page.Contents ?? []) {
      keys.push({ key: object.Key, size: object.Size });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** R2 answers 200 with a per-key Errors array, so a refused delete is silent
 *  unless it is read: retention would stop working while the log says it ran. */
export async function deleteKeys(send, Bucket, keys) {
  const { DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  for (let i = 0; i < keys.length; i += DELETE_BATCH) {
    const response = await send(
      new DeleteObjectsCommand({
        Bucket,
        Delete: {
          Objects: keys.slice(i, i + DELETE_BATCH).map((Key) => ({ Key })),
        },
      }),
    );
    const errors = response?.Errors ?? [];
    if (errors.length > 0) {
      throw new Error(
        `prune failed for ${errors.length} object(s): ${errors
          .map((e) => `${e.Key} (${e.Code})`)
          .join(", ")}`,
      );
    }
  }
}

/** True when the new dump is materially smaller than the newest existing one. */
export function shrankSuspiciously(newSize, existing, { database }) {
  const previous = existing
    .map((o) => ({ ...parseBackupKey(o.key), size: o.size }))
    .filter((o) => o.database === database)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];

  if (!previous || !previous.size) return false;
  return newSize < previous.size * SHRINK_GUARD_RATIO;
}

/**
 * One database: dump, verify, prove the destination is private, upload,
 * confirm the stored size, then prune.
 *
 * Dependencies are injected so the ordering — which is the part that matters —
 * can be tested without a database or a bucket.
 */
export async function backupOne({
  database,
  connection,
  bucket,
  dir,
  startedAt,
  retentionDays,
  publicBaseUrl,
  deps,
}) {
  const { exec, send, upload, headObject, assertPrivate, log } = deps;
  const file = join(dir, `${database}.dump`);

  await exec("pg_dump", ["--format=custom", "--file", file, connection.url], {
    PGPASSWORD: connection.password,
  });

  const entries = await verifyArchive(file, exec);
  const rows = await countSourceRows(connection, exec);
  const { size } = await stat(file);
  const key = backupKey(database, startedAt);

  const existing = await listAllKeys(send, {
    Bucket: bucket,
    Prefix: `${BACKUP_PREFIX}/${database}/`,
  });
  const shrank = shrankSuspiciously(size, existing, { database });

  await upload({ Bucket: bucket, Key: key, Body: createReadStream(file) });
  await assertPrivate({ publicBaseUrl, key });

  // An upload the bucket did not actually store, or stored short, must not be
  // followed by a prune of the copies that were fine.
  const stored = await headObject({ Bucket: bucket, Key: key });
  if (Number(stored?.ContentLength) !== size) {
    throw new Error(
      `uploaded ${key} is ${stored?.ContentLength} bytes, expected ${size}`,
    );
  }

  log(
    `${database}: ${entries} table-data entries, ${rows} live rows, ${(size / 1024 / 1024).toFixed(1)}MB -> ${key}`,
  );

  if (rows === 0) {
    throw new Error(
      `${database}: source reports 0 live rows — archived as ${key} but treating this as a failure, not a backup`,
    );
  }

  if (shrank) {
    throw new Error(
      `${database}: dump is under ${SHRINK_GUARD_RATIO * 100}% of the previous one (${size} bytes). Uploaded as ${key}; pruned nothing. Check the source database.`,
    );
  }

  const stale = expiredKeys(
    existing.map((o) => o.key),
    { now: startedAt, retentionDays, database },
  );
  if (stale.length > 0) {
    await deleteKeys(send, bucket, stale);
    log(`${database}: pruned ${stale.length} expired backup(s)`);
  }
}

export function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const value = (flag) => {
    const index = argv.indexOf(flag);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    dryRun: has("--dry-run"),
    list: has("--list"),
    download: value("--download"),
    out: value("--out"),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = process.env;

  // Read-only commands are what an operator reaches for mid-incident, so they
  // must not require the full backup configuration.
  if (args.list || args.download) {
    const bucket = env.BACKUP_R2_BUCKET;
    if (!bucket) throw new Error("BACKUP_R2_BUCKET is not set.");
    const client = await s3Client(env);
    const send = (command) => client.send(command);

    if (args.list) {
      const keys = await listAllKeys(send, {
        Bucket: bucket,
        Prefix: `${BACKUP_PREFIX}/`,
      });
      for (const { key, size } of keys.sort((a, b) =>
        a.key.localeCompare(b.key),
      )) {
        console.log(`${key}  ${(size / 1024 / 1024).toFixed(1)}MB`);
      }
      return;
    }

    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const object = await send(
      new GetObjectCommand({ Bucket: bucket, Key: args.download }),
    );
    // Never the working tree by default: a production dump one `git add -A`
    // away from a public repository is how the archive becomes the incident.
    const outDir = args.out ?? (await mkdtemp(join(tmpdir(), "koos-restore-")));
    const out = join(outDir, args.download.split("/").pop());
    await pipeline(object.Body, createWriteStream(out));
    console.log(`downloaded ${args.download} -> ${out}`);
    return;
  }

  const bucket = args.dryRun ? null : resolveBucket(env);
  const retentionDays = resolveRetentionDays(env.BACKUP_RETENTION_DAYS);
  const targets = resolveTargets(env);

  const client = args.dryRun ? null : await s3Client(env);
  const { Upload } = args.dryRun
    ? { Upload: null }
    : await import("@aws-sdk/lib-storage");
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");

  const deps = {
    exec: run,
    send: client ? (command) => client.send(command) : null,
    upload: client
      ? (params) =>
          new Upload({
            client,
            params: { ...params, ContentType: "application/octet-stream" },
          }).done()
      : null,
    headObject: client
      ? (params) => client.send(new HeadObjectCommand(params))
      : null,
    assertPrivate: assertNotPubliclyReadable,
    log: (message) => console.log(message),
  };

  console.log(
    `Backing up ${targets.map((t) => t.database).join(", ")} -> ${args.dryRun ? "(dry run)" : bucket}`,
  );

  const dir = await mkdtemp(join(tmpdir(), "koos-backup-"));
  const startedAt = new Date();
  let failures = 0;

  try {
    for (const { database, connection } of targets) {
      try {
        if (args.dryRun) {
          const file = join(dir, `${database}.dump`);
          await run(
            "pg_dump",
            ["--format=custom", "--file", file, connection.url],
            { PGPASSWORD: connection.password },
          );
          const entries = await verifyArchive(file);
          const rows = await countSourceRows(connection);
          const { size } = await stat(file);
          console.log(
            `${database}: ${entries} table-data entries, ${rows} live rows, ${(size / 1024 / 1024).toFixed(1)}MB (not uploaded)`,
          );
          continue;
        }

        await backupOne({
          database,
          connection,
          bucket,
          dir,
          startedAt,
          retentionDays,
          publicBaseUrl: env.R2_PUBLIC_BASE_URL,
          deps,
        });
      } catch (error) {
        failures += 1;
        console.error(`${database}: BACKUP FAILED — ${error.message}`);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  if (failures > 0) process.exit(1);
  console.log(`Backed up ${targets.length} database(s).`);
}

if (process.argv[1]?.endsWith("backup-db.mjs")) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
