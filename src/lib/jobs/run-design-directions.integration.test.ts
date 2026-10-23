// @vitest-environment node
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * The directions job end to end against the local Postgres: real context
 * resolution, real rows, real document building and satori rendering, real
 * byte checks on the upload. Only the paid and remote edges are doubles: the
 * language model, the plate model and the bucket.
 *
 * Opt-in, so the gate lane stays free of a database: it runs only when
 * KOOS_INTEGRATION_DATABASE_URL names a database on this machine, never the
 * shared staging one .env points at, and skips itself when that database is
 * down or does not have migration 0037 yet.
 *
 *   KOOS_INTEGRATION_DATABASE_URL=postgres://koos:koos@localhost:5434/koos \
 *     corepack pnpm vitest run src/lib/jobs/run-design-directions.integration.test.ts
 */

const LOCAL_DB = process.env.KOOS_INTEGRATION_DATABASE_URL ?? "";
const isLocal =
  /^postgres(ql)?:\/\/[^@]+@(localhost|127\.0\.0\.1)(:\d+)?\//.test(LOCAL_DB);
const PUBLIC_BASE = "https://cdn.test.example";

const generateObject = vi.fn();
const plateGenerate = vi.fn();
const judgeAndCorrect = vi.fn();
const bucket = new Map<string, Uint8Array>();

vi.mock("ai", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateObject: (o: unknown) => generateObject(o),
}));
vi.mock("@/lib/ai/provider", () => ({ getModel: () => "model" }));
vi.mock("@/lib/ai/image", () => ({
  resolveDesignProviders: () => [],
  getNativeAdapters: () => [],
  getPlateAdapter: () => ({
    id: "bedrock-stability",
    label: "Stability",
    model: "stable-image-core",
    supportsTextRendering: false,
    supportsReferenceImages: false,
    generate: plateGenerate,
  }),
}));
vi.mock("@/lib/design/quality/judge", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  judgeAndCorrect: (args: unknown) => judgeAndCorrect(args),
}));
/* The vision look is a paid call like the models: the plate always shows
   the product, the photo's subject is where the test says. */
vi.mock("@/lib/design/quality/plate-check", () => ({
  checkPlateShowsProduct: async () => ({
    shows: true,
    seen: "almond croissants",
    subject: { x: 0.3, y: 0.35, w: 0.4, h: 0.4 },
    items: ["almond croissants"],
    lettering: false,
  }),
  lookAtPhoto: async () => ({
    description: "almond croissants on a plate",
    subject: { x: 0.3, y: 0.35, w: 0.4, h: 0.4 },
    face: null,
    items: ["almond croissants", "a plate"],
  }),
}));
vi.mock("@/lib/analytics/posthog-server", () => ({
  captureServerEvent: vi.fn(),
}));
vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  uploadObject: async ({ key, body }: { key: string; body: Uint8Array }) => {
    bucket.set(key, new Uint8Array(body));
  },
  getObjectBytes: async (key: string) => {
    const bytes = bucket.get(key);
    if (!bytes) {
      const err = new Error(`no such key ${key}`);
      err.name = "NoSuchKey";
      throw err;
    }
    return Buffer.from(bytes);
  },
}));

const previousUrl = process.env.DATABASE_URL;
if (isLocal) process.env.DATABASE_URL = LOCAL_DB;
vi.stubEnv("R2_PUBLIC_BASE_URL", PUBLIC_BASE);

async function localDatabaseReady(): Promise<boolean> {
  if (!isLocal) return false;
  const probe = postgres(LOCAL_DB, { max: 1, connect_timeout: 2 });
  try {
    const rows = await probe`
      select 1 from information_schema.columns
      where table_name = 'design_generations' and column_name = 'document'`;
    return rows.length === 1;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 }).catch(() => {});
  }
}

const ready = await localDatabaseReady();

describe.runIf(ready)("directions job against the local database", () => {
  const sql = postgres(LOCAL_DB, { max: 1 });
  const userId = randomUUID();
  const workspaceId = randomUUID();
  const brandId = randomUUID();
  const uploadKey = `design-images/${brandId}/${randomUUID()}.png`;

  let mods: {
    generateDirectionsWork: typeof import("./run-design-directions").generateDirectionsWork;
    resolveDesignContext: typeof import("@/lib/design/context").resolveDesignContext;
    designDocumentSchema: typeof import("@/lib/design/document/schema").designDocumentSchema;
    draftOf: typeof import("./directions/fixtures").draftOf;
    contrastingDraft: typeof import("./directions/fixtures").contrastingDraft;
  };

  const runtime = {
    jobId: "job-int",
    reportProgress: vi.fn(),
    checkpoint: {},
    saveCheckpoint: vi.fn(),
    shouldPause: () => false,
  };

  async function photoPng(width: number, height: number) {
    const { encodePngRgba } = await import("@/lib/images/png-pixels");
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const at = (y * width + x) * 4;
        /* A gradient with grain: a flat fill would compress like an empty
           frame and say nothing about how a photograph renders. */
        const grain = ((x * 7919 + y * 104729) % 23) - 11;
        pixels[at] = Math.min(255, Math.max(0, 180 + (x % 64) + grain));
        pixels[at + 1] = Math.min(255, Math.max(0, 120 + (y % 80) + grain));
        pixels[at + 2] = Math.min(255, Math.max(0, 90 + grain));
        pixels[at + 3] = 255;
      }
    }
    return encodePngRgba({ width, height, pixels });
  }

  async function job(request: Record<string, unknown>) {
    const context = await mods.resolveDesignContext({
      brandId,
      freeform:
        "Launch our almond croissant for commuters on weekday mornings. Order ahead for pickup.",
      aspectRatio: "4:5",
    });
    return mods.generateDirectionsWork(
      { context, userId, sessionId: null, request: request as never },
      runtime as never,
    );
  }

  const rowsFor = () =>
    sql`select id, spec, document, rationale, image_source, source_image_key,
               image_key, status, renderer
        from design_generations where brand_id = ${brandId}
        order by created_at`;

  beforeAll(async () => {
    const [{ generateDirectionsWork }, { resolveDesignContext }, schema, fx] =
      await Promise.all([
        import("./run-design-directions"),
        import("@/lib/design/context"),
        import("@/lib/design/document/schema"),
        import("./directions/fixtures"),
      ]);
    mods = {
      generateDirectionsWork,
      resolveDesignContext,
      designDocumentSchema: schema.designDocumentSchema,
      draftOf: fx.draftOf,
      contrastingDraft: fx.contrastingDraft,
    };

    await sql`insert into users (id, first_name, last_name, email, email_verified_at)
              values (${userId}, 'Directions', 'Test', ${`directions-${userId}@qa.test`}, now())`;
    await sql`insert into workspaces (id, name, owner_id, access_status)
              values (${workspaceId}, 'Directions test', ${userId}, 'approved')`;
    await sql`insert into brands (id, user_id, workspace_id, name, primary_color, secondary_color, overview, logo_url)
              values (${brandId}, ${userId}, ${workspaceId}, 'Crumb & Co.', '#FFF4E6', '#C2410C',
                      'Neighbourhood bakery in Lekki', ${`${PUBLIC_BASE}/logos/${brandId}/mark.png`})`;

    const { logoPng } = await import("@/lib/design/render/logo-fixtures");
    bucket.set(
      `logos/${brandId}/mark.png`,
      logoPng({
        width: 400,
        height: 100,
        color: [59, 36, 22, 255],
        shape: "block",
      }),
    );
    bucket.set(uploadKey, await photoPng(900, 900));

    judgeAndCorrect.mockResolvedValue({
      corrected: false,
      spec: null,
      verdict: null,
      applied: null,
    });
    plateGenerate.mockImplementation(async () => ({
      bytes: await photoPng(512, 640),
      contentType: "image/png",
    }));
  });

  afterAll(async () => {
    /* The user owns the workspace and the brand, so this one delete takes
       the rows, the usage events and the brand with it. */
    await sql`delete from users where id = ${userId}`;
    await sql.end({ timeout: 2 });
    process.env.DATABASE_URL = previousUrl;
    vi.unstubAllEnvs();
  });

  it("writes two editable directions on the upload, with no image-model call", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        directions: [
          mods.draftOf({ layout: "hero-center" }),
          mods.contrastingDraft({ layout: "hero-center" }),
        ],
      },
    });
    const outcome = await job({ image: { source: "upload", key: uploadKey } });
    const ids = (outcome.result as { generationIds: string[] }).generationIds;
    expect(ids).toHaveLength(2);
    expect(plateGenerate).not.toHaveBeenCalled();

    const rows = await rowsFor();
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
    const layouts = rows.map((r) => r.spec.layout);
    expect(new Set(layouts).size).toBe(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "succeeded",
        renderer: "composite",
        image_source: "upload",
        source_image_key: uploadKey,
      });
      expect(row.image_key).toMatch(new RegExp(`^generated/${brandId}/`));
      expect(bucket.has(row.image_key)).toBe(true);
      const doc = mods.designDocumentSchema.parse(row.document);
      const keys = doc.elements.flatMap((e) =>
        "asset" in e ? [e.asset.key] : [],
      );
      expect(keys).toContain(uploadKey);
      expect(
        keys.some((k) => k.startsWith(`generated/${brandId}/marks/`)),
      ).toBe(true);
      expect(row.rationale.reasons.length).toBeGreaterThanOrEqual(2);
      expect(row.rationale.set).toBe(rows[0].rationale.set);
    }

    const usage = await sql`select metadata from usage_events
        where brand_id = ${brandId} and kind = 'design_generated'`;
    expect(usage).toHaveLength(1);
    expect(usage[0].metadata).toMatchObject({
      imageCalls: 0,
      renderers: ["composite:upload", "composite:upload"],
    });
  }, 180_000);

  it("paints one stored plate per direction on the KO path, then regenerates one", async () => {
    generateObject.mockResolvedValueOnce({
      object: {
        directions: [
          mods.draftOf({ layout: "split-left" }),
          mods.contrastingDraft({ layout: "stat-highlight" }),
        ],
      },
    });
    const first = await job({ image: { source: "ko" } });
    const [slot0] = (first.result as { generationIds: string[] }).generationIds;
    expect(plateGenerate).toHaveBeenCalledTimes(2);

    const koRows = (await rowsFor()).filter((r) => r.image_source === "ko");
    for (const row of koRows) {
      const doc = mods.designDocumentSchema.parse(row.document);
      const image = doc.elements.find((e) => e.type === "image");
      expect(image && "asset" in image ? image.asset.key : "").toMatch(
        new RegExp(`^generated/${brandId}/plates/`),
      );
    }

    plateGenerate.mockClear();
    generateObject.mockResolvedValueOnce({
      object: {
        directions: [
          mods.draftOf({
            layout: "split-left",
            title: "Almond gift box",
            headline: "Give a box of almond joy",
            subheadline: "Twelve pastries, one ribbon",
            cta: "Pre-order",
            backgroundPrompt: "a ribboned pastry box on linen",
          }),
        ],
      },
    });
    const again = await job({
      image: { source: "ko" },
      regenerateOf: slot0,
    });
    const [newId] = (again.result as { generationIds: string[] }).generationIds;
    expect(plateGenerate).toHaveBeenCalledTimes(1);

    const [replacement] =
      await sql`select spec, rationale from design_generations where id = ${newId}`;
    const original = koRows.find((r) => r.id === slot0);
    expect(replacement.rationale.set).toBe(original?.rationale.set);
    expect(replacement.rationale.slot).toBe(original?.rationale.slot);
    expect(["split-left", "stat-highlight"]).not.toContain(
      replacement.spec.layout,
    );
  }, 180_000);

  /* Round-2 code critic: with no lock, two regenerates on the two slots
     each read the same old pair and both took the same layout. End to end
     here; the next test holds the lock across two connections. */
  it("gives two concurrent regenerates on the two slots different layouts", async () => {
    const live = await sql`select id, spec, rationale from design_generations
        where brand_id = ${brandId} and image_source = 'ko' and status = 'succeeded'
        order by created_at desc`;
    const set = live[0].rationale.set;
    const shown = [0, 1].map(
      (slot) =>
        live.find((r) => r.rationale.set === set && r.rationale.slot === slot)
          ?.id,
    );
    expect(shown.every(Boolean)).toBe(true);
    /* Both answers propose the same free layout, which is what a model
       shown the same pair tends to do. */
    generateObject.mockImplementation(async (o: { schema?: unknown }) => ({
      object: {
        directions: [
          mods.draftOf({
            layout: "banner-bottom",
            title: "Almond gift box",
            headline: "Give a box of almond joy",
            subheadline: "Pastries for the commute",
            cta: "Pre-order",
            backgroundPrompt: "a ribboned pastry box on linen",
          }),
        ],
      },
      schema: o.schema,
    }));
    const [a, b] = await Promise.all(
      shown.map((id) => job({ image: { source: "ko" }, regenerateOf: id })),
    );
    generateObject.mockReset();
    const ids = [a, b].map(
      (o) => (o.result as { generationIds: string[] }).generationIds[0],
    );
    const made = await sql`select id, spec, status from design_generations
        where id in ${sql(ids)}`;
    expect(made.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
    expect(made[0].spec.layout).not.toBe(made[1].spec.layout);
  }, 240_000);

  /* The race itself, made wide: each job takes 300 ms to choose, about
     what building candidate documents costs, with no lock held. Both
     choose the same layout; the claim lets one have it and sends the other
     back to choose again from the set as it now is. */
  it("gives two racing jobs on one set different layouts, holding no lock while choosing", async () => {
    const { claimDirectionLayout, listDirectionSet } = await import(
      "@/lib/db/queries"
    );
    const { layoutCandidates } = await import("./directions/layouts");
    const { settleDirectionLayout } = await import("./directions/layout-claim");
    const set = randomUUID();
    const [first, second] = await Promise.all(
      [0, 1].map(async (slot) => {
        const [row] = await sql`insert into design_generations
            (brand_id, user_id, source, spec, renderer, provider, model, status, rationale)
          values (${brandId}, ${userId}, 'quick',
            ${sql.json({ layout: "hero-center" })}, 'composite', 'upload', 'none', 'pending',
            ${sql.json({ title: "t", reasons: [], set, slot })})
          returning id`;
        return { id: row.id as string, slot };
      }),
    );
    /* Two connections, as two server instances would have. */
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const schema = await import("@/lib/db/schema");
    const clients = [0, 1].map(() => postgres(LOCAL_DB, { max: 1 }));
    const databases = clients.map((client) => drizzle(client, { schema }));
    let chooses = 0;
    let openWhileChoosing = 0;
    const settle = ({ id, slot }: { id: string; slot: number }) =>
      settleDirectionLayout({
        self: { id, set, slot },
        readSet: () => listDirectionSet(brandId, set),
        choose: async (held) => {
          chooses += 1;
          const [{ open }] = await sql`select count(*)::int as open
              from pg_locks where locktype = 'advisory' and granted`;
          openWhileChoosing = Math.max(openWhileChoosing, open);
          await new Promise((resolve) => setTimeout(resolve, 300));
          const layout = layoutCandidates(
            "split-left",
            held.filter((l) => l !== "hero-center"),
          )[0];
          return {
            spec: {
              layout,
            } as unknown as import("@/lib/design/spec").DesignSpec,
          };
        },
        claim: (spec, isFree) =>
          claimDirectionLayout({
            database: databases[slot] as never,
            brandId,
            setId: set,
            rowId: id,
            spec,
            isFree: (rows) => isFree(rows.filter((r) => r.id !== id)),
          }),
      });
    const picked = await Promise.all([settle(first), settle(second)]).finally(
      () => Promise.all(clients.map((c) => c.end({ timeout: 2 }))),
    );
    expect(picked[0].spec.layout).not.toBe(picked[1].spec.layout);
    expect(chooses).toBe(3);
    expect(openWhileChoosing).toBe(0);
    const stored = await sql`select spec from design_generations
        where id in ${sql([first.id, second.id])}`;
    expect(new Set(stored.map((r) => r.spec.layout)).size).toBe(2);
  });

  it("refuses a blank upload with the reason, writing nothing", async () => {
    const before = (await rowsFor()).length;
    const blank = `design-images/${brandId}/${randomUUID()}.png`;
    const { encodePngRgba } = await import("@/lib/images/png-pixels");
    const pixels = new Uint8Array(600 * 600 * 4).fill(253);
    bucket.set(blank, encodePngRgba({ width: 600, height: 600, pixels }));
    await expect(
      job({ image: { source: "upload", key: blank } }),
    ).rejects.toThrow(/^This image can't be used: it looks blank/);
    expect((await rowsFor()).length).toBe(before);
  });

  it("fails an upload that is not really a PNG, writing nothing", async () => {
    const before = (await rowsFor()).length;
    const fake = `design-images/${brandId}/${randomUUID()}.png`;
    bucket.set(fake, new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 data"));
    await expect(
      job({ image: { source: "upload", key: fake } }),
    ).rejects.toThrow(/^This image can't be used/);
    expect((await rowsFor()).length).toBe(before);
  });
});
