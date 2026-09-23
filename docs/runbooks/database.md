# Database runbook

Covers the two things that actually happen: the database disappearing, and
needing data back.

## Topology

| Environment | Database | Host |
| --- | --- | --- |
| production | `defaultdb` | the Aiven service in `DATABASE_URL` |
| staging | `koos-staging-db` | the same service |

**Both databases live on one Aiven service.** Anything that takes the service
down takes production and staging with it. Splitting production onto its own
service is outstanding work (see the end of this page).

## Symptom: `getaddrinfo ENOTFOUND …aivencloud.com`

The Aiven service is powered off or deleted. Aiven publishes a service's DNS
record only while it runs, so the hostname stops resolving entirely.

This is not a DNS fault and not a connection-limit problem. Confirm in seconds:

```bash
getent hosts "$(grep -oP '(?<=@)[^:]+' <<<"$DATABASE_URL")"   # nothing
getent hosts aivencloud.com                                   # resolves
```

**Pages still return 200 during this outage.** The login shell is static and
only the submit touches the database, so a page's HTTP status proves nothing.
Use `/api/health`, which opens a real connection and counts rows in
`_migrations`:

```bash
curl -s https://app.kocontentstudios.com/api/health | jq
```

| Response | Meaning |
| --- | --- |
| `200 {"status":"ok"}` | app and database both healthy |
| `503 reason:"unreachable"` | service powered off or deleted (DNS gone) |
| `503 reason:"timeout"` | it accepted the connection and never answered |
| `503 reason:"error"` | it answered and refused: connection cap, credentials, or an **empty database** |

### Fix

1. Open the [Aiven console](https://console.aiven.io) and find the service.
2. **Powered off** → power it on. DNS returns within a few minutes and both
   environments recover on their own. The storage volume is untouched, so no
   data is lost (verified 2026-09-23: every row came back).
3. **Not listed** → it was deleted. Contact Aiven support immediately about
   backup recovery, and in parallel restore from R2 (below). Deletion also
   destroys Aiven's own backups, so the R2 copy may be all there is.

### Why it powered off on 2026-09-23

Aiven powered the service off for account inactivity — nobody had logged into
the **Aiven console** for days. Database traffic does not reset that clock, so
monitoring detects this but cannot prevent it. Prevention is a paid plan
without the idle rule, or a standing calendar reminder to log in.

## Monitoring

| Layer | What it catches | Limits |
| --- | --- | --- |
| `/api/health` | the app cannot reach or read the database | only as good as who calls it |
| `.github/workflows/uptime.yml`, every 15 min | prod and staging down | **GitHub disables schedules after 60 days of repo inactivity** and delays runs under load |
| An external monitor (UptimeRobot, BetterStack, Cronitor) | everything above, plus GitHub Actions being down | not configured yet — see below |

**The GitHub workflow must not be the only monitor**: it shares the inactivity
failure mode with the incident it watches for. Point an external monitor at
both `/api/health` URLs, alerting on any non-200, and keep the workflow as the
second line.

## Backups

`scripts/backup-db.mjs` dumps every database with `pg_dump -Fc`, verifies each
archive by **restoring it to `/dev/null`** (which forces every data block
through the decompressor, unlike `--list`, which reads only the header),
uploads it with a streamed multipart PUT, then prunes.

It runs nightly at 02:00 UTC (`.github/workflows/backup.yml`) and on demand:

```bash
node scripts/backup-db.mjs              # dump, verify, upload, prune
node scripts/backup-db.mjs --dry-run    # dump + verify only, no upload
node scripts/backup-db.mjs --list       # what is in the bucket
node scripts/backup-db.mjs --download backups/defaultdb/<timestamp>.dump
```

`--list` and `--download` need only `BACKUP_R2_BUCKET` and the R2 credentials,
so they work mid-incident without the full backup configuration. Downloads land
in a temp directory unless `--out DIR` says otherwise: a production dump inside
the working tree is one `git add -A` away from being published.

Safety rules built into the script, each covered by a test:

- **Backups never go in the app bucket**, in three layers, because the first
  one alone was not enough: it compares `BACKUP_R2_BUCKET` against `R2_BUCKET`
  (which only helps when `R2_BUCKET` is in the environment — the CI job now
  passes it deliberately); it refuses to upload at all unless
  `BACKUP_BUCKET_IS_PRIVATE=true` says an operator has checked the destination;
  and after each upload it **fetches the new key anonymously through
  `R2_PUBLIC_BASE_URL`** and fails the run if it answers. Configuration is a
  claim; that fetch is the measurement.
- **An empty source fails the run.** Row counts come from the source database,
  counted exactly — `pg_dump` writes a TABLE DATA entry per table whatever the
  row count, so the archive itself cannot tell a full database from an empty
  one, and `n_live_tup`/`reltuples` are planner statistics that the 2026-09-23
  restart reset (a database holding 1,262 rows reported 1).
- **Uploads are size-checked.** The stored object's `ContentLength` must match
  the local file before anything is pruned.
- **`BACKUP_DATABASES` is required.** Guessing from the connection string
  silently backed up one of two databases and still exited 0.
- **`BACKUP_RETENTION_DAYS` must be an integer ≥ 7.** `0` would prune
  everything but the newest 3 on the next run, and the bucket has no versioning.
- **The newest 3 copies of each database are never pruned**, however old.
- **A dump under 50% of the previous one is uploaded, prunes nothing, and
  fails the run** so the alert fires — an emptied database still produces a
  structurally valid archive, and a warning in a log nobody reads is how the
  original incident stayed invisible.
- **A refused delete fails the run.** R2 answers `200` with a per-key `Errors`
  array, so an unread response means retention silently stops working.

### Restore

```bash
# 1. Find and fetch the archive (prints where it saved it)
node scripts/backup-db.mjs --list
node scripts/backup-db.mjs --download backups/defaultdb/<timestamp>.dump --out /tmp

# 2. Restore into a scratch container and CHECK IT before touching anything real
docker run -d --name restore-check -e POSTGRES_PASSWORD=t -e POSTGRES_USER=t \
  -e POSTGRES_DB=restored -p 5439:5432 postgres:17-alpine
PGPASSWORD=t pg_restore --no-owner --no-acl -h localhost -p 5439 -U t \
  -d restored <timestamp>.dump
PGPASSWORD=t psql -h localhost -p 5439 -U t -d restored -c 'select count(*) from users'

# 3. Only then restore into the real target
pg_restore --no-owner --no-acl --clean --if-exists -d "$TARGET_URL" <timestamp>.dump
```

`--clean --if-exists` drops and recreates objects, so it **overwrites the
target**. Never point it at production without doing step 2 first.

The dumps carry `citext`, so a restored database does not need the extension
created by hand the way `README.md` describes for an empty one.

**What the dumps do not carry:** roles and cluster-wide grants
(`pg_dumpall --globals-only` needs privileges the Aiven user does not have). A
restore into a fresh service reproduces the data and schema, not the server's
role list. Recreate the application role by hand before restoring.

`.github/workflows/restore-drill.yml` runs the whole path weekly — download,
restore into a real PostgreSQL, assert tables, migrations and users are present
— and opens an issue when it fails. That drill, not the nightly job, is the
thing that proves the backups work.

## Required configuration

Repository secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `BACKUP_DATABASE_URL` | Aiven connection string (any database on the service) |
| `BACKUP_R2_BUCKET` | the **private** backup bucket, e.g. `koos-backups` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | as in `.env` |
| `R2_BUCKET`, `R2_PUBLIC_BASE_URL` | the app bucket and its public domain, so the guards can compare and probe |
| `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` | optional, recommended: a token scoped to the backup bucket alone, so an app-side credential leak cannot read or delete the backups |

Repository variables: `BACKUP_DATABASES` = `defaultdb,koos-staging-db`,
`BACKUP_RETENTION_DAYS` = `30`, `BACKUP_BUCKET_IS_PRIVATE` = `true` (set only
after checking the bucket's public access is disabled in Cloudflare).

Optional app env: `HEALTH_PROBE_TOKEN`. When set, `/api/health` answers 401
without the `x-health-token` header and never touches the database, which caps
what an anonymous flood can cost. Configure the monitor to send it.

Labels the workflows use (both exist): `outage`, `backup-failed`. The workflows
also re-create them with `--force` before raising an issue, because
`gh issue create --label` fails outright when a label is missing and would lose
the alert instead of raising it.

## Outstanding

1. **Split production onto its own Aiven service.** One service failing
   currently takes both environments, and a staging experiment can exhaust
   connections production needs. Steps: create a second service, back up and
   `pg_restore` `defaultdb` into it, repoint `DATABASE_URL`/`DIRECT_URL` in the
   Vercel production environment and redeploy (migrations run at build time),
   verify `/api/health`, then drop the old copy after a day. Keep both in
   `BACKUP_DATABASES` until then.
2. **Configure the external monitor** described above.
3. **Scope the backup credentials.** The workflows currently fall back to the
   app's R2 keys, which can read and delete every dump. A token scoped to
   `koos-backups` closes that.
4. **The app bucket is public, bucket-wide.** `deliverables/`, `brand-docs/`
   and `reference-images/` are therefore readable by anyone who knows a key,
   which the in-app download gating does not prevent. Keys are unguessable
   (UUID plus random suffix), so this is a latent risk, not an active leak, but
   private artifacts belong in a private bucket served through signed URLs.
