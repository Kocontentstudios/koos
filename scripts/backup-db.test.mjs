import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertNotPubliclyReadable,
  backupKey,
  backupOne,
  countDataEntries,
  countSourceRows,
  DEFAULT_RETENTION_DAYS,
  deleteKeys,
  expiredKeys,
  listAllKeys,
  MIN_KEPT,
  MIN_RETENTION_DAYS,
  parseArgs,
  parseBackupKey,
  resolveBucket,
  resolveRetentionDays,
  resolveTargets,
  shrankSuspiciously,
  splitConnection,
  verifyArchive,
} from "./backup-db.mjs";

const NOW = new Date("2026-09-23T02:00:00.000Z");
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
const PRIVATE_ENV = { BACKUP_BUCKET_IS_PRIVATE: "true" };

describe("backupKey / parseBackupKey", () => {
  it("round-trips a database and timestamp", () => {
    const key = backupKey("defaultdb", NOW, "abc123");

    expect(key).toBe("backups/defaultdb/2026-09-23T02-00-00-000Z-abc123.dump");
    expect(parseBackupKey(key)).toMatchObject({
      database: "defaultdb",
      date: NOW,
    });
  });

  /* Two runs in the same millisecond would otherwise write the same key and
     the second would silently replace the first. */
  it("gives concurrent runs distinct keys", () => {
    expect(backupKey("defaultdb", NOW)).not.toBe(backupKey("defaultdb", NOW));
  });

  it("still reads keys written before the suffix existed", () => {
    expect(
      parseBackupKey("backups/defaultdb/2026-09-23T02-00-00-000Z.dump"),
    ).toMatchObject({ database: "defaultdb", date: NOW });
  });

  it("handles a database name with a hyphen", () => {
    expect(
      parseBackupKey(backupKey("koos-staging-db", NOW, "aa11bb")).database,
    ).toBe("koos-staging-db");
  });

  it.each([
    "backups/db/not-a-date.dump",
    "backups/db/2026-09-23T02-00-00-000Z.sql",
    "deliverables/db/2026-09-23T02-00-00-000Z.dump",
    "backups/2026-09-23T02-00-00-000Z.dump",
    "backups//2026-09-23T02-00-00-000Z.dump",
  ])("refuses to parse %s", (key) => {
    expect(parseBackupKey(key)).toBeNull();
  });
});

describe("resolveBucket", () => {
  /* The 2026-09-23 leak: dumps went to the app's bucket, which has bucket-wide
     public read, and the production archive was anonymously downloadable. */
  it("refuses to write backups into the public app bucket", () => {
    expect(() =>
      resolveBucket({
        ...PRIVATE_ENV,
        BACKUP_R2_BUCKET: "koos",
        R2_BUCKET: "koos",
      }),
    ).toThrow(/publicly readable/);
  });

  /* The comparison above only fires when R2_BUCKET is in the environment, and
     a CI job need not set it. This is the guard that does not depend on that. */
  it("refuses to upload unless the destination is declared private", () => {
    expect(() => resolveBucket({ BACKUP_R2_BUCKET: "koos-backups" })).toThrow(
      /BACKUP_BUCKET_IS_PRIVATE/,
    );
  });

  it("requires an explicit backup bucket", () => {
    expect(() => resolveBucket({ ...PRIVATE_ENV, R2_BUCKET: "koos" })).toThrow(
      /BACKUP_R2_BUCKET/,
    );
  });

  it("accepts a private bucket distinct from the app bucket", () => {
    expect(
      resolveBucket({
        ...PRIVATE_ENV,
        BACKUP_R2_BUCKET: "koos-backups",
        R2_BUCKET: "koos",
      }),
    ).toBe("koos-backups");
  });
});

describe("assertNotPubliclyReadable", () => {
  /* Configuration guards are declarations; this is the measurement. */
  it("throws when the uploaded object answers anonymously", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200 });

    await expect(
      assertNotPubliclyReadable(
        { publicBaseUrl: "https://pub-x.r2.dev", key: "backups/db/x.dump" },
        fetchImpl,
      ),
    ).rejects.toThrow(/PUBLIC EXPOSURE/);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://pub-x.r2.dev/backups/db/x.dump",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("passes when the object is not served", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 });

    await expect(
      assertNotPubliclyReadable(
        { publicBaseUrl: "https://pub-x.r2.dev", key: "k" },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ checked: true, status: 404 });
  });

  it("reports unchecked rather than failing when the probe cannot run", async () => {
    await expect(
      assertNotPubliclyReadable({ publicBaseUrl: "", key: "k" }),
    ).resolves.toEqual({ checked: false });

    await expect(
      assertNotPubliclyReadable({ publicBaseUrl: "https://x", key: "k" }, () =>
        Promise.reject(new Error("network")),
      ),
    ).resolves.toEqual({ checked: false });
  });
});

describe("resolveRetentionDays", () => {
  it("defaults when unset or blank", () => {
    expect(resolveRetentionDays(undefined)).toBe(DEFAULT_RETENTION_DAYS);
    expect(resolveRetentionDays("")).toBe(DEFAULT_RETENTION_DAYS);
  });

  /* "0" is truthy, survives a `||` fallback and prunes everything but MIN_KEPT
     on the next run — against a bucket with no versioning that is final. */
  it.each(["0", "-1", "3", "thirty", "7.5"])("rejects %s", (raw) => {
    expect(() => resolveRetentionDays(raw)).toThrow(/BACKUP_RETENTION_DAYS/);
  });

  it("accepts the documented minimum and above", () => {
    expect(resolveRetentionDays(`${MIN_RETENTION_DAYS}`)).toBe(
      MIN_RETENTION_DAYS,
    );
    expect(resolveRetentionDays("90")).toBe(90);
  });
});

describe("expiredKeys", () => {
  const key = (n, db = "defaultdb") =>
    backupKey(db, daysAgo(n), `${n}`.padStart(6, "0"));

  it("deletes nothing inside the window", () => {
    expect(
      expiredKeys([key(1), key(2), key(3), key(4)], {
        now: NOW,
        retentionDays: 30,
      }),
    ).toEqual([]);
  });

  it("deletes only what is past the window", () => {
    expect(
      expiredKeys([key(1), key(2), key(3), key(31), key(60)], {
        now: NOW,
        retentionDays: 30,
      }),
    ).toEqual([key(31), key(60)]);
  });

  it(`always keeps the newest ${MIN_KEPT} however old`, () => {
    expect(
      expiredKeys([key(400), key(500), key(600), key(700)], {
        now: NOW,
        retentionDays: 30,
      }),
    ).toEqual([key(700)]);
  });

  it("keeps a backup exactly at the boundary", () => {
    expect(
      expiredKeys([key(1), key(2), key(3), key(30)], {
        now: NOW,
        retentionDays: 30,
      }),
    ).toEqual([]);
  });

  it("ignores keys it cannot parse rather than deleting them", () => {
    expect(
      expiredKeys(
        [key(1), key(2), key(3), key(90), "backups/defaultdb/README"],
        {
          now: NOW,
          retentionDays: 30,
        },
      ),
    ).toEqual([key(90)]);
  });

  /* MIN_KEPT counts per database. Mixing them lets one busy database's copies
     stand in for another's and expose it to a full prune. */
  it("counts the keep-newest guarantee per database", () => {
    const keys = [
      key(1),
      key(2),
      key(3),
      key(400, "koos-staging-db"),
      key(500, "koos-staging-db"),
    ];

    expect(
      expiredKeys(keys, {
        now: NOW,
        retentionDays: 30,
        database: "koos-staging-db",
      }),
    ).toEqual([]);
  });
});

describe("shrankSuspiciously", () => {
  const object = (n, size) => ({
    key: backupKey("defaultdb", daysAgo(n), "aaaaaa"),
    size,
  });

  it("flags a dump that collapses against the previous one", () => {
    expect(
      shrankSuspiciously(100_000, [object(1, 1_000_000)], {
        database: "defaultdb",
      }),
    ).toBe(true);
  });

  it("accepts normal growth and small variation", () => {
    expect(
      shrankSuspiciously(950_000, [object(1, 1_000_000)], {
        database: "defaultdb",
      }),
    ).toBe(false);
  });

  it("compares against the newest copy, not an arbitrary one", () => {
    expect(
      shrankSuspiciously(100_000, [object(30, 10), object(1, 1_000_000)], {
        database: "defaultdb",
      }),
    ).toBe(true);
  });

  it("has nothing to compare on the first ever backup", () => {
    expect(shrankSuspiciously(1, [], { database: "defaultdb" })).toBe(false);
  });

  it("ignores other databases' sizes", () => {
    const existing = [
      {
        key: backupKey("koos-staging-db", daysAgo(1), "bbbbbb"),
        size: 9_000_000,
      },
    ];

    expect(shrankSuspiciously(1_000, existing, { database: "defaultdb" })).toBe(
      false,
    );
  });
});

describe("listAllKeys", () => {
  /* ListObjectsV2 caps at 1000. Keys are ISO timestamps, so an unpaginated
     read returns the OLDEST page and "keep the newest 3" quietly becomes a lie. */
  it("follows pagination to the end", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({
        Contents: [{ Key: "backups/db/a.dump", Size: 1 }],
        IsTruncated: true,
        NextContinuationToken: "t1",
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: "backups/db/b.dump", Size: 2 }],
        IsTruncated: false,
      });

    const keys = await listAllKeys(send, { Bucket: "b", Prefix: "backups/" });

    expect(keys.map((k) => k.key)).toEqual([
      "backups/db/a.dump",
      "backups/db/b.dump",
    ]);
    expect(send.mock.calls[1][0].input.ContinuationToken).toBe("t1");
  });

  it("handles an empty bucket", async () => {
    const send = vi.fn().mockResolvedValue({ IsTruncated: false });

    await expect(
      listAllKeys(send, { Bucket: "b", Prefix: "backups/" }),
    ).resolves.toEqual([]);
  });
});

describe("deleteKeys", () => {
  it("batches deletes under the 1000-key API limit", async () => {
    const send = vi.fn().mockResolvedValue({});
    const keys = Array.from(
      { length: 2_001 },
      (_, i) => `backups/db/${i}.dump`,
    );

    await deleteKeys(send, "bucket", keys);

    expect(send).toHaveBeenCalledTimes(3);
    for (const [command] of send.mock.calls) {
      expect(command.input.Delete.Objects.length).toBeLessThanOrEqual(1000);
    }
  });

  /* R2 answers 200 with a per-key Errors array: unread, retention silently
     stops working while the log reports success. */
  it("throws when the response reports per-key failures", async () => {
    const send = vi.fn().mockResolvedValue({
      Errors: [{ Key: "backups/db/a.dump", Code: "AccessDenied" }],
    });

    await expect(
      deleteKeys(send, "bucket", ["backups/db/a.dump"]),
    ).rejects.toThrow(/AccessDenied/);
  });

  it("sends nothing when there is nothing to delete", async () => {
    const send = vi.fn();

    await deleteKeys(send, "bucket", []);

    expect(send).not.toHaveBeenCalled();
  });
});

describe("countDataEntries", () => {
  const toc = [
    ";     Archive created at 2026-09-23",
    "215; 1259 16583 TABLE public users avnadmin",
    "3456; 0 16583 TABLE DATA public users avnadmin",
    "3457; 0 16590 TABLE DATA public brands avnadmin",
    "2200; 2606 16600 CONSTRAINT public users users_pkey avnadmin",
  ].join("\n");

  it("counts table data entries, not table definitions", () => {
    expect(countDataEntries(toc)).toBe(2);
  });

  it("returns 0 for a schema-only archive", () => {
    expect(
      countDataEntries("215; 1259 16583 TABLE public users avnadmin"),
    ).toBe(0);
  });
});

describe("verifyArchive", () => {
  /* --list reads only the header, so a file truncated halfway lists every
     table and passes. Restoring to /dev/null decodes every data block. */
  it("decodes the whole archive before trusting it", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("3456; 0 16583 TABLE DATA public users avnadmin");

    await verifyArchive("/tmp/x.dump", exec);

    expect(exec).toHaveBeenNthCalledWith(1, "pg_restore", [
      "--file",
      "/dev/null",
      "/tmp/x.dump",
    ]);
    expect(exec).toHaveBeenNthCalledWith(2, "pg_restore", [
      "--list",
      "/tmp/x.dump",
    ]);
  });

  it("propagates a corrupt archive rather than uploading it", async () => {
    const exec = vi.fn().mockRejectedValue(new Error("unexpected end of file"));

    await expect(verifyArchive("/tmp/x.dump", exec)).rejects.toThrow(
      /unexpected end of file/,
    );
  });

  it("rejects an archive that declares no table data", async () => {
    const exec = vi
      .fn()
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(";  nothing");

    await expect(verifyArchive("/tmp/x.dump", exec)).rejects.toThrow(
      /no table data/,
    );
  });
});

describe("countSourceRows", () => {
  /* pg_dump writes a TABLE DATA entry per table whatever the row count, so the
     archive cannot tell a full database from an empty one. The source can. */
  it("reads live row totals from the source database", async () => {
    const exec = vi.fn().mockResolvedValue("2022\n");

    await expect(
      countSourceRows({ url: "postgres://h/db", password: "p" }, exec),
    ).resolves.toBe(2022);
    expect(exec.mock.calls[0][2]).toEqual({ PGPASSWORD: "p" });
  });

  /* n_live_tup and reltuples are planner statistics: the 2026-09-23 restart
     reset them, and a database holding 1,262 rows reported 1. */
  it("counts rows exactly instead of trusting planner statistics", async () => {
    const exec = vi.fn().mockResolvedValue("2022\n");

    await countSourceRows({ url: "postgres://h/db", password: "p" }, exec);

    const sql = exec.mock.calls[0][1].join(" ");
    expect(sql).toContain("count(*)");
    expect(sql).not.toContain("n_live_tup");
    expect(sql).not.toContain("reltuples");
  });

  it("reports zero for an empty database", async () => {
    const exec = vi.fn().mockResolvedValue("0\n");

    await expect(
      countSourceRows({ url: "postgres://h/db", password: "p" }, exec),
    ).resolves.toBe(0);
  });
});

describe("backupOne", () => {
  let dir;
  let deps;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "backup-one-"));
    deps = {
      exec: vi.fn(async (command, args) => {
        if (command === "pg_dump") {
          await writeFile(args[args.indexOf("--file") + 1], "x".repeat(1_000));
          return "";
        }
        if (command === "psql") return "2022\n";
        if (args[0] === "--list") {
          return "3456; 0 16583 TABLE DATA public users avnadmin";
        }
        return "";
      }),
      send: vi.fn().mockResolvedValue({ IsTruncated: false, Contents: [] }),
      upload: vi.fn().mockResolvedValue({}),
      headObject: vi.fn().mockResolvedValue({ ContentLength: 1_000 }),
      assertPrivate: vi.fn().mockResolvedValue({ checked: true }),
      log: vi.fn(),
    };
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const run = (overrides = {}) =>
    backupOne({
      database: "defaultdb",
      connection: { url: "postgres://h/defaultdb", password: "p" },
      bucket: "koos-backups",
      dir,
      startedAt: NOW,
      retentionDays: 30,
      publicBaseUrl: "https://pub-x.r2.dev",
      deps,
      ...overrides,
    });

  it("verifies the archive before uploading it", async () => {
    await run();

    const order = deps.exec.mock.calls.map(([command, args]) =>
      command === "pg_restore" ? `pg_restore ${args[0]}` : command,
    );
    expect(order).toEqual([
      "pg_dump",
      "pg_restore --file",
      "pg_restore --list",
      "psql",
    ]);
    expect(deps.upload).toHaveBeenCalledTimes(1);
  });

  it("never uploads an archive that fails verification", async () => {
    deps.exec.mockImplementation(async (command, args) => {
      if (command === "pg_dump") {
        await writeFile(args[args.indexOf("--file") + 1], "x");
        return "";
      }
      throw new Error("corrupt archive");
    });

    await expect(run()).rejects.toThrow(/corrupt archive/);
    expect(deps.upload).not.toHaveBeenCalled();
  });

  /* The destination being private is proved against the live bucket, not
     assumed from configuration. */
  it("fails the run when the uploaded object is publicly readable", async () => {
    deps.assertPrivate.mockRejectedValue(new Error("PUBLIC EXPOSURE: ..."));

    await expect(run()).rejects.toThrow(/PUBLIC EXPOSURE/);
    const deletes = deps.send.mock.calls.filter(
      ([command]) => command.constructor.name === "DeleteObjectsCommand",
    );
    expect(deletes).toHaveLength(0);
  });

  it("refuses to prune when the stored object is short", async () => {
    deps.headObject.mockResolvedValue({ ContentLength: 12 });

    await expect(run()).rejects.toThrow(/expected 1000/);
  });

  /* An emptied source still produces a structurally valid archive; pruning
     behind it would destroy the copies that still hold the data. */
  it("fails, and prunes nothing, when the source has no rows", async () => {
    deps.exec.mockImplementation(async (command, args) => {
      if (command === "pg_dump") {
        await writeFile(args[args.indexOf("--file") + 1], "x".repeat(1_000));
        return "";
      }
      if (command === "psql") return "0\n";
      if (args[0] === "--list") {
        return "3456; 0 16583 TABLE DATA public users avnadmin";
      }
      return "";
    });

    await expect(run()).rejects.toThrow(/0 live rows/);
    const deletes = deps.send.mock.calls.filter(
      ([command]) => command.constructor.name === "DeleteObjectsCommand",
    );
    expect(deletes).toHaveLength(0);
  });

  it("fails, and prunes nothing, when the dump collapses in size", async () => {
    deps.send.mockResolvedValue({
      IsTruncated: false,
      Contents: [
        { Key: backupKey("defaultdb", daysAgo(1), "aaaaaa"), Size: 1_000_000 },
      ],
    });

    await expect(run()).rejects.toThrow(/under 50% of the previous one/);
    const deletes = deps.send.mock.calls.filter(
      ([command]) => command.constructor.name === "DeleteObjectsCommand",
    );
    expect(deletes).toHaveLength(0);
  });

  it("prunes expired copies on a healthy run", async () => {
    const stale = backupKey("defaultdb", daysAgo(90), "cccccc");
    deps.send.mockImplementation(async (command) => {
      if (command.constructor.name === "ListObjectsV2Command") {
        return {
          IsTruncated: false,
          Contents: [
            { Key: stale, Size: 900 },
            { Key: backupKey("defaultdb", daysAgo(1), "dddddd"), Size: 900 },
            { Key: backupKey("defaultdb", daysAgo(2), "eeeeee"), Size: 900 },
            { Key: backupKey("defaultdb", daysAgo(3), "ffffff"), Size: 900 },
          ],
        };
      }
      return {};
    });

    await run();

    const deletes = deps.send.mock.calls.filter(
      ([command]) => command.constructor.name === "DeleteObjectsCommand",
    );
    expect(deletes).toHaveLength(1);
    expect(deletes[0][0].input.Delete.Objects).toEqual([{ Key: stale }]);
  });
});

describe("parseArgs", () => {
  it("reads the read-only commands", () => {
    expect(parseArgs(["--list"])).toMatchObject({ list: true });
    expect(
      parseArgs(["--download", "backups/db/x.dump", "--out", "/tmp"]),
    ).toMatchObject({ download: "backups/db/x.dump", out: "/tmp" });
    expect(parseArgs(["--dry-run"])).toMatchObject({ dryRun: true });
  });

  it("defaults to a full backup", () => {
    expect(parseArgs([])).toEqual({
      dryRun: false,
      list: false,
      download: undefined,
      out: undefined,
    });
  });
});

describe("resolveTargets", () => {
  const base =
    "postgres://u:p%40ss@pg-x.aivencloud.com:17462/defaultdb?sslmode=require";

  it("expands the configured database list onto one server", () => {
    const targets = resolveTargets({
      DATABASE_URL: base,
      BACKUP_DATABASES: "defaultdb, koos-staging-db",
    });

    expect(targets.map((t) => t.database)).toEqual([
      "defaultdb",
      "koos-staging-db",
    ]);
    expect(targets[1].connection.url).toContain("/koos-staging-db");
    expect(targets[1].connection.url).toContain("sslmode=require");
  });

  it("prefers DIRECT_URL, matching scripts/migrate.mjs", () => {
    const targets = resolveTargets({
      DATABASE_URL: base,
      DIRECT_URL: base.replace("pg-x", "pg-direct"),
      BACKUP_DATABASES: "defaultdb",
    });

    expect(targets[0].connection.url).toContain("pg-direct");
  });

  /* Falling back to the connection string's own database silently backed up
     one of two databases and still exited 0. */
  it("refuses to guess when the database list is missing", () => {
    expect(() => resolveTargets({ DATABASE_URL: base })).toThrow(
      /BACKUP_DATABASES/,
    );
  });

  /* A name with a slash builds a key parseBackupKey rejects, so those objects
     would never be pruned. */
  it.each(["a/b", "db name", "db;drop"])("rejects the name %s", (database) => {
    expect(() =>
      resolveTargets({ DATABASE_URL: base, BACKUP_DATABASES: database }),
    ).toThrow(/Invalid database name/);
  });

  it("throws when no connection string is configured", () => {
    expect(() => resolveTargets({ BACKUP_DATABASES: "defaultdb" })).toThrow(
      /DATABASE_URL/,
    );
  });
});

describe("splitConnection", () => {
  /* argv is world-readable through /proc; the password goes via PGPASSWORD. */
  it("strips the password out of the connection string", () => {
    const { url, password } = splitConnection(
      new URL("postgres://user:s3cr%40t@host:5432/db?sslmode=require"),
    );

    expect(url).not.toContain("s3cr");
    expect(url).toContain("user@host:5432/db");
    expect(password).toBe("s3cr@t");
  });
});
