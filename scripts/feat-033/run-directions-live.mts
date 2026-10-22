/**
 * Runs the FEAT-033 directions job end to end against the LOCAL database and
 * the configured R2 bucket: one upload-path job per photo, one KO-imagery
 * job, and a regenerate of the KO job's first direction. Real model, real
 * plate model and plate check, real storage. The local-verify counterpart of
 * the integration test.
 *
 *   corepack pnpm tsx --env-file=<file with AI_*, AWS_*, R2_*> \
 *     scripts/feat-033/run-directions-live.mts [outDir] [photo.png|jpg ...]
 *
 * Refuses any DATABASE_URL that is not the docker database on localhost:5434,
 * because .env points at the shared staging database. Writes only under
 * design-images/{qa brand}/ and generated/{qa brand}/ in the bucket, the
 * usual local-verify practice. Saves each direction's PNG and document to
 * outDir (default /tmp/feat-033/u3-r2) and prints timings and image-call
 * counts, counted by wrapping the plate adapter rather than trusting the
 * job's own counter, plus the round-2 outcomes from the usage row.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const LOCAL_DB = "postgres://koos:koos@localhost:5434/koos";
const configured = process.env.DATABASE_URL;
if (configured && !/@localhost:5434\//.test(configured)) {
  console.error("Refusing to run: DATABASE_URL is not the local database.");
  process.exit(1);
}
process.env.DATABASE_URL = LOCAL_DB;
// A stale bearer token hijacks auth from the SigV4 keys (verify skill).
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const outDir = process.argv[2] ?? "/tmp/feat-033/u3-r2";
const photoPaths =
  process.argv.length > 3
    ? process.argv.slice(3)
    : [
        "/tmp/feat-033/fixtures/cutout.png",
        "/tmp/feat-033/fixtures/photo-a.jpg",
      ];

const { default: postgres } = await import("postgres");
const { default: sharp } = await import("sharp");
const { getPlateAdapter } = await import("@/lib/ai/image");
const { resolveDesignContext } = await import("@/lib/design/context");
const { generateDesignWork } = await import("@/lib/jobs/run-design-generation");
const { getObjectBytes, uploadObject } = await import("@/lib/storage");
const { designImageKeyFor } = await import("@/lib/uploads/design-image");

const QA_USER_EMAIL = "ada.client@qa.test";
const QA_BRAND_NAME = "FEAT-033 QA Bakery";
const sql = postgres(LOCAL_DB, { max: 1 });

async function qaBrand(): Promise<string> {
  const [existing] =
    await sql`select id from brands where name = ${QA_BRAND_NAME}`;
  if (existing) return existing.id;
  const [user] = await sql`
    select u.id as user_id, w.id as workspace_id from users u
    join workspaces w on w.owner_id = u.id where u.email = ${QA_USER_EMAIL}`;
  if (!user) throw new Error(`No local QA user ${QA_USER_EMAIL}`);
  const [brand] = await sql`
    insert into brands (user_id, workspace_id, name, overview, target_audience,
                        tone, offer, primary_color, secondary_color, additional_colors)
    values (${user.user_id}, ${user.workspace_id}, ${QA_BRAND_NAME},
            'Neighbourhood French bakery in Lekki, Lagos.',
            'Commuters on weekday mornings and weekend brunch regulars',
            'Warm, unfussy, a little playful',
            'Laminated pastry baked before sunrise',
            '#FFF4E6', '#C2410C', ${["#3B2416"]})
    returning id`;
  return brand.id;
}

const brandId = await qaBrand();
const [{ user_id: userId }] =
  await sql`select user_id from brands where id = ${brandId}`;

const plate = getPlateAdapter();
let imageCalls = 0;
if (plate) {
  const generate = plate.generate.bind(plate);
  plate.generate = async (input) => {
    imageCalls += 1;
    return generate(input);
  };
}

const progress: string[] = [];
const runtime = {
  jobId: "live",
  reportProgress: (p: {
    stage?: string;
    done: number;
    total: number;
    label: string;
  }) => progress.push(`${p.stage}:${p.done}/${p.total}`),
  checkpoint: {},
  saveCheckpoint: async () => {},
  shouldPause: () => false,
};

await mkdir(outDir, { recursive: true });
const brief =
  "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.";

async function run(
  name: string,
  directions: {
    image: { source: "upload"; key: string } | { source: "ko" };
    regenerateOf?: string;
  },
) {
  progress.length = 0;
  imageCalls = 0;
  const context = await resolveDesignContext({
    brandId,
    freeform: brief,
    aspectRatio: "4:5",
  });
  const started = performance.now();
  const outcome = await generateDesignWork(
    { context, userId, sessionId: null, directions },
    runtime as never,
  );
  const seconds = (performance.now() - started) / 1000;
  const ids = (outcome.result as { generationIds: string[] }).generationIds;
  const rows = await sql`
    select id, spec, rationale, image_key, image_source, document
    from design_generations where id = any(${ids})`;
  const [usage] = await sql`
    select metadata from usage_events where brand_id = ${brandId}
    order by created_at desc limit 1`;
  const report = [];
  for (const row of rows) {
    const slot = row.rationale.slot;
    const file = join(outDir, `${name}-slot${slot}-${row.spec.layout}.png`);
    await writeFile(file, await getObjectBytes(row.image_key));
    await writeFile(
      file.replace(/\.png$/, ".document.json"),
      JSON.stringify(row.document, null, 2),
    );
    report.push({
      id: row.id,
      slot,
      layout: row.spec.layout,
      title: row.rationale.title,
      headline: row.spec.headline,
      subheadline: row.spec.subheadline ?? null,
      cta: row.spec.cta ?? null,
      footerLines: row.spec.footerLines,
      reasons: row.rationale.reasons,
      assets: row.document.elements.flatMap((e: { asset?: { key: string } }) =>
        e.asset ? [e.asset.key] : [],
      ),
      file,
    });
  }
  const summary = {
    job: name,
    seconds: Number(seconds.toFixed(1)),
    imageCallsCounted: imageCalls,
    imageCallsOnUsageRow: usage.metadata.imageCalls,
    renderers: usage.metadata.renderers,
    plateChecks: usage.metadata.plateChecks,
    fitAsked: usage.metadata.fitAsked,
    fitFixed: usage.metadata.fitFixed,
    copyFallbacks: usage.metadata.copyFallbacks,
    reasonsDropped: usage.metadata.reasonsDropped,
    qualityFaults: usage.metadata.qualityFaults,
    modelCalls: usage.metadata.modelCalls,
    progress: [...new Set(progress)],
    directions: report,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const results = [];
const uploadKeys: string[] = [];
for (const photoPath of photoPaths) {
  const ext = photoPath.endsWith(".png") ? "png" : "jpg";
  /* What the browser's normaliser sends (normalize-image.ts): the image
     fitted inside 2560 px, PNG kept PNG, everything else JPEG. Uploading
     the raw fixture would test a path no browser takes. */
  const fitted = sharp(await readFile(photoPath)).resize(2560, 2560, {
    fit: "inside",
    withoutEnlargement: true,
  });
  const photo = new Uint8Array(
    ext === "png"
      ? await fitted.png().toBuffer()
      : await fitted.jpeg({ quality: 92 }).toBuffer(),
  );
  const uploadKey = designImageKeyFor(brandId, ext);
  uploadKeys.push(uploadKey);
  await uploadObject({
    key: uploadKey,
    body: photo,
    contentType: ext === "png" ? "image/png" : "image/jpeg",
  });
  const name = `upload-${photoPath
    .split("/")
    .pop()
    ?.replace(/\.\w+$/, "")}`;
  results.push(
    await run(name, { image: { source: "upload", key: uploadKey } }),
  );
}
const ko = await run("ko", { image: { source: "ko" } });
results.push(ko);
const first = ko.directions.find((d) => d.slot === 0) ?? ko.directions[0];
results.push(
  await run("ko-regenerate", {
    image: { source: "ko" },
    regenerateOf: first.id,
  }),
);
await writeFile(
  join(outDir, "live-summary.json"),
  JSON.stringify({ brandId, uploadKeys, brief, results }, null, 2),
);
await sql.end();
process.exit(0);
