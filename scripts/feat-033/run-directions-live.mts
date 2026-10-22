/**
 * Runs the FEAT-033 directions job end to end against the LOCAL database and
 * the configured R2 bucket, for the round-3 live check: the round-1 bakery
 * brief on the cut-out and on KO imagery plus one regenerate, a cafe brief
 * on a busy espresso-bar photo, a fashion brief on a portrait, and the kids'
 * workshop brief on a near-blank photo, which must be refused. Real model,
 * real plate model and checks, real storage. The local-verify counterpart of
 * the integration test.
 *
 *   corepack pnpm tsx --env-file=<file with AI_*, AWS_*, R2_*> \
 *     scripts/feat-033/run-directions-live.mts [outDir]
 *
 * Refuses any DATABASE_URL that is not the docker database on localhost:5434,
 * because .env points at the shared staging database. Creates its own QA
 * user, workspace and brands when they are missing. Writes only under
 * design-images/{qa brand}/ and generated/{qa brand}/ in the bucket. Uploads
 * each photo as the browser normaliser would send it. Saves each
 * direction's PNG and layer document to outDir (default /tmp/feat-033/u3-r3)
 * with live-summary.json, counting image calls by wrapping the plate adapter
 * rather than trusting the job's own counter.
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

const outDir = process.argv[2] ?? "/tmp/feat-033/u3-r3";
const FIXTURES = "/tmp/feat-033/fixtures";

const { default: postgres } = await import("postgres");
const { getPlateAdapter } = await import("@/lib/ai/image");
const { resolveDesignContext } = await import("@/lib/design/context");
const { generateDesignWork } = await import("@/lib/jobs/run-design-generation");
const { getObjectBytes, uploadObject } = await import("@/lib/storage");
const { designImageKeyFor } = await import("@/lib/uploads/design-image");
const { normaliseLikeBrowser } = await import(
  "@/lib/ai/design-directions/eval/normalise"
);

const QA_USER_EMAIL = "feat033.live@qa.test";
const sql = postgres(LOCAL_DB, { max: 1 });

async function qaOwner(): Promise<{ userId: string; workspaceId: string }> {
  const [found] = await sql`
    select u.id as user_id, w.id as workspace_id from users u
    join workspaces w on w.owner_id = u.id where u.email = ${QA_USER_EMAIL}`;
  if (found) return { userId: found.user_id, workspaceId: found.workspace_id };
  const [user] = await sql`
    insert into users (first_name, last_name, email, email_verified_at)
    values ('Feat', 'Live', ${QA_USER_EMAIL}, now()) returning id`;
  const [workspace] = await sql`
    insert into workspaces (name, owner_id, access_status)
    values ('FEAT-033 live QA', ${user.id}, 'approved') returning id`;
  return { userId: user.id, workspaceId: workspace.id };
}

interface QaBrandProfile {
  name: string;
  overview: string;
  audience: string;
  tone: string;
  offer: string;
  colors: [string, string, string];
}

async function qaBrand(
  owner: { userId: string; workspaceId: string },
  profile: QaBrandProfile,
): Promise<string> {
  const [existing] =
    await sql`select id from brands where name = ${profile.name}`;
  if (existing) return existing.id;
  const [brand] = await sql`
    insert into brands (user_id, workspace_id, name, overview, target_audience,
                        tone, offer, primary_color, secondary_color, additional_colors)
    values (${owner.userId}, ${owner.workspaceId}, ${profile.name},
            ${profile.overview}, ${profile.audience}, ${profile.tone},
            ${profile.offer}, ${profile.colors[0]}, ${profile.colors[1]},
            ${[profile.colors[2]]})
    returning id`;
  return brand.id;
}

const owner = await qaOwner();
const userId = owner.userId;
const brands = {
  bakery: await qaBrand(owner, {
    name: "FEAT-033 QA Bakery",
    overview: "Neighbourhood French bakery in Lekki, Lagos.",
    audience: "Commuters on weekday mornings and weekend brunch regulars",
    tone: "Warm, unfussy, a little playful",
    offer: "Laminated pastry baked before sunrise",
    colors: ["#FFF4E6", "#C2410C", "#3B2416"],
  }),
  cafe: await qaBrand(owner, {
    name: "FEAT-033 QA Coffee Bar",
    overview: "Specialty coffee bar in Yaba, Lagos.",
    audience: "Remote workers and students",
    tone: "Easygoing, curious, precise about coffee",
    offer: "Single-origin espresso and pour-over",
    colors: ["#1C1917", "#D97706", "#F5F5F4"],
  }),
  fashion: await qaBrand(owner, {
    name: "FEAT-033 QA Womenswear",
    overview: "Contemporary adire womenswear studio in Ikoyi, Lagos.",
    audience: "Women who dress for work and weekends in one wardrobe",
    tone: "Assured, warm, unhurried",
    offer: "Hand-dyed adire dresses and separates",
    colors: ["#F5F0E6", "#1E3A8A", "#7C2D12"],
  }),
};

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

const BRIEFS = {
  bakery:
    "Launch our new strawberry mille-feuille, ₦4,500 a slice, available from Monday. Commuters can order ahead for pickup from 7am.",
  cafe: "Our new single-origin espresso flight is here: three shots for ₦6,000, every weekday from 8am at our Yaba bar. Walk in, no booking needed.",
  fashion:
    "Pre-orders open for the Harmattan linen dress, ₦38,000, from Friday 1 November on adirehouse.ng.",
  workshop:
    "Kids' croissant-making workshop this Saturday, 10am to 12pm at our Lekki shop. ₦15,000 per child, ages 7 to 12, only 8 spots. Book on WhatsApp 0803 555 0142.",
};

interface Job {
  name: string;
  brand: keyof typeof brands;
  brief: keyof typeof BRIEFS;
  aspect: "1:1" | "4:5";
  photo?: string;
  regenerateOf?: string;
  mustRefuse?: boolean;
}

async function uploadPhoto(brandId: string, photoPath: string) {
  const normalised = await normaliseLikeBrowser(await readFile(photoPath));
  const key = designImageKeyFor(
    brandId,
    normalised.type === "png" ? "png" : "jpg",
  );
  await uploadObject({
    key,
    body: new Uint8Array(normalised.bytes),
    contentType: normalised.type === "png" ? "image/png" : "image/jpeg",
  });
  return key;
}

async function run(job: Job) {
  progress.length = 0;
  imageCalls = 0;
  const brandId = brands[job.brand];
  const brief = BRIEFS[job.brief];
  const image = job.photo
    ? { source: "upload" as const, key: await uploadPhoto(brandId, job.photo) }
    : { source: "ko" as const };
  const context = await resolveDesignContext({
    brandId,
    freeform: brief,
    aspectRatio: job.aspect,
  });
  const [{ count: rowsBefore }] =
    await sql`select count(*)::int as count from design_generations where brand_id = ${brandId}`;
  const started = performance.now();
  let outcome: Awaited<ReturnType<typeof generateDesignWork>>;
  try {
    outcome = await generateDesignWork(
      {
        context,
        userId,
        sessionId: null,
        directions: { image, regenerateOf: job.regenerateOf },
      },
      runtime as never,
    );
  } catch (err) {
    const [{ count: rowsAfter }] =
      await sql`select count(*)::int as count from design_generations where brand_id = ${brandId}`;
    const summary = {
      job: job.name,
      brief,
      aspect: job.aspect,
      photo: job.photo ?? null,
      refused: (err as Error).message,
      mustRefuse: Boolean(job.mustRefuse),
      rowsWritten: rowsAfter - rowsBefore,
      imageCallsCounted: imageCalls,
      seconds: Number(((performance.now() - started) / 1000).toFixed(1)),
    };
    console.log(JSON.stringify(summary, null, 2));
    return { ...summary, directions: [] as { id: string; slot: number }[] };
  }
  const seconds = (performance.now() - started) / 1000;
  const ids = (outcome.result as { generationIds: string[] }).generationIds;
  const rows = await sql`
    select id, spec, rationale, image_key, image_source, document
    from design_generations where id = any(${ids})`;
  const [usage] = await sql`
    select metadata from usage_events where brand_id = ${brandId}
    order by created_at desc limit 1`;
  const failedRows = await sql`
    select id, error from design_generations
    where id = any(${(outcome.result as { failed: string[] }).failed})`;
  const report = [];
  for (const row of rows) {
    const slot = row.rationale.slot;
    const file = join(outDir, `${job.name}-slot${slot}-${row.spec.layout}.png`);
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
  const m = usage.metadata;
  const summary = {
    job: job.name,
    brief,
    aspect: job.aspect,
    photo: job.photo ?? null,
    regenerateOf: job.regenerateOf ?? null,
    mustRefuse: Boolean(job.mustRefuse),
    seconds: Number(seconds.toFixed(1)),
    imageCallsCounted: imageCalls,
    imageCallsOnUsageRow: m.imageCalls,
    renderers: m.renderers,
    plateChecks: m.plateChecks,
    productSources: m.productSources,
    subjectKnown: m.subjectKnown,
    subjectFaults: m.subjectFaults,
    layoutsRelaid: m.layoutsRelaid,
    briefFacts: m.briefFacts,
    briefFactsDelivered: m.briefFactsDelivered,
    factsAdded: m.factsAdded,
    factsLeftOff: m.factsLeftOff,
    fitAsked: m.fitAsked,
    fitFixed: m.fitFixed,
    copyFallbacks: m.copyFallbacks,
    reasonsDropped: m.reasonsDropped,
    qualityFaults: m.qualityFaults,
    modelCalls: m.modelCalls,
    failed: failedRows.map((r) => ({ id: r.id, error: r.error })),
    progress: [...new Set(progress)],
    directions: report,
  };
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

const results = [];
results.push(
  await run({
    name: "r1-upload",
    brand: "bakery",
    brief: "bakery",
    aspect: "4:5",
    photo: `${FIXTURES}/cutout.png`,
  }),
);
const ko = await run({
  name: "r1-ko",
  brand: "bakery",
  brief: "bakery",
  aspect: "4:5",
});
results.push(ko);
const first = ko.directions.find((d) => d.slot === 0) ?? ko.directions[0];
if (first) {
  results.push(
    await run({
      name: "r1-ko-regen",
      brand: "bakery",
      brief: "bakery",
      aspect: "4:5",
      regenerateOf: first.id,
    }),
  );
}
results.push(
  await run({
    name: "cafe-photo",
    brand: "cafe",
    brief: "cafe",
    aspect: "1:1",
    photo: `${FIXTURES}/busy-cafe-espresso.jpg`,
  }),
);
results.push(
  await run({
    name: "fashion-photo",
    brand: "fashion",
    brief: "fashion",
    aspect: "4:5",
    photo: `${FIXTURES}/portrait-fashion.jpg`,
  }),
);
results.push(
  await run({
    name: "workshop-blank",
    brand: "bakery",
    brief: "workshop",
    aspect: "1:1",
    photo: `${FIXTURES}/photo-a.jpg`,
    mustRefuse: true,
  }),
);
await writeFile(
  join(outDir, "live-summary.json"),
  JSON.stringify({ brands, results }, null, 2),
);
await sql.end();
process.exit(0);
