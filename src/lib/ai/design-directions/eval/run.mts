/**
 * Periodic eval for the directions brief (FEAT-033): does the model write two
 * genuinely different concepts, to length, stating only the brief's facts,
 * with "why this works" reasons that are true of the design, does KO imagery
 * show the product the brief names, and (round 3) does the design a client
 * receives keep copy off the product, show it whole, carry every fact the
 * brief gave, and refuse a photograph with nothing in it?
 *
 * Paid lane: one structured completion per case (more when the fit pass or
 * the redraft rule fires), text plus the photograph on the upload cases, the
 * real plate model plus the plate check on KO cases, a look at each
 * photograph's subject, then per delivered direction a look at the rendered
 * PNG and a text judge of its copy against the brief. Run before shipping a
 * change to src/lib/jobs/directions/, the directions prompt or either model,
 * and nightly. Not part of `pnpm test`.
 *
 * It runs the production functions: draftDirections, paintCheckedPlate,
 * lookAtPhoto, chooseLayout with the builders' subject check, and the
 * document renderer, so the fit pass, finalising, fact coverage, the layout
 * rule, the plate retry and the subject rule are measured as they ship. The
 * judge gate and storage are left out: nothing is uploaded. Renders, layer
 * documents and plates are saved to --out for a person to look at.
 *
 * Round 5 adds the brief reader: before the cases, every labelled brief
 * (read-cases.ts) is read on its own and scored for precision and recall,
 * and each case's own read is scored against its labels; coverage is
 * measured against the labels, never against the reader it checks.
 *
 * Usage: pnpm eval:design-directions [--case <id>] [--image <png|jpg>]
 *          [--out <dir>] [--no-plates] [--read-only]
 *   --image is the upload for cases without their own fixture; it defaults
 *   to /tmp/feat-033/fixtures/cutout.png when present.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}
// A stale bearer token hijacks auth from the valid SigV4 keys and fails every
// call with "Forbidden".
process.env.AWS_BEARER_TOKEN_BEDROCK = "";

const { inferCategory } = await import("../../design-training/infer-category");
const { getPlateAdapter } = await import("../../image");
const { brandFacts, draftDirections } = await import(
  "../../../jobs/directions/brief"
);
const { planConcepts, regenerationConcept } = await import(
  "../../../jobs/directions/concepts"
);
const { briefNamesPeople, paintCheckedPlate } = await import(
  "../../../jobs/directions/imagery"
);
const { designSpecOf } = await import("../../../jobs/directions/schema");
const { askVision } = await import("../../../design/quality/vision");
const { lookAtPhoto } = await import("../../../design/quality/plate-check");
const {
  brandRegion,
  brandSetting,
  factsMissing,
  needsFor,
  phoneRegions,
  settleBriefFacts,
} = await import("../../../jobs/directions/brief-facts");
type BriefFact = import("../../../jobs/directions/brief-facts").BriefFact;
const { readBriefWithModel, settleBriefRead } = await import(
  "../../../jobs/directions/brief-read"
);
const { contentStems } = await import("../../../jobs/directions/text-overlap");
const { READ_EVAL_CASES } = await import("./read-cases");
const {
  aggregateReads,
  labelKind,
  readFailures,
  READ_THRESHOLDS,
  scoreBriefRead,
} = await import("./read-score");
type ReadScore = import("./read-score").ReadScore;
const { chooseLayout, LAYOUT_CRAFT_FAILED, SUBJECT_FACE_ONLY } = await import(
  "../../../jobs/directions/subject-layout"
);
const { directionGateRules, documentRenderer, layoutJudge } = await import(
  "../../../jobs/directions/render"
);
const { copyNamesOffering, correctionHolds, drawnCopyOf, settleReasons } =
  await import("../../../jobs/directions/finalize");
const { layoutCraftFaults } = await import("../../../jobs/directions/craft");
const { placeholderIn } = await import("../../../jobs/directions/claims");
const { guardRender } = await import("../../../jobs/design-gate");
const { respecForLayout } = await import("../../../jobs/design-logo-settle");
const { measureImage } = await import("../../../design/document/image-facts");
const { prepareDocumentFonts } = await import(
  "../../../design/document/rasterize"
);
const { measureSubject, SUBJECT_COVERED, SUBJECT_CROPPED, subjectFromAlpha } =
  await import("../../../design/document/subject");
const { designImageFromBytes, DesignImageError } = await import(
  "../../../uploads/design-image"
);
const { normaliseLikeBrowser } = await import("./normalise");
const { DIRECTIONS_EVAL_CASES, DIRECTIONS_EVAL_THRESHOLDS } = await import(
  "./cases"
);
const { aggregateDirections, directionsFailures, scoreDirectionsCase } =
  await import("./score");
const {
  aggregateRender,
  craftOfDelivered,
  isCropped,
  renderFailures,
  RENDER_THRESHOLDS,
} = await import("./render-score");
type RenderedCase = import("./render-score").RenderedCase;
type RenderedDirection = import("./render-score").RenderedDirection;

const args = process.argv.slice(2);
const flag = (name: string) =>
  args.includes(name) ? args[args.indexOf(name) + 1] : null;
const only = flag("--case");
const outDir = flag("--out") ?? "qa-reports/eval/design-directions-renders";
const withPlates = !args.includes("--no-plates");
const readOnly = args.includes("--read-only");
const imagePath =
  flag("--image") ??
  (existsSync("/tmp/feat-033/fixtures/cutout.png")
    ? "/tmp/feat-033/fixtures/cutout.png"
    : null);
const image = imagePath
  ? {
      bytes: new Uint8Array(readFileSync(imagePath)),
      contentType: imagePath.endsWith(".png") ? "image/png" : "image/jpeg",
    }
  : null;

const cases = readOnly
  ? []
  : only
    ? DIRECTIONS_EVAL_CASES.filter((c) => c.id === only)
    : DIRECTIONS_EVAL_CASES;
if (cases.length === 0 && !readOnly) {
  console.error(only ? `No case named "${only}"` : "No cases defined");
  process.exit(1);
}
const plateAdapter = withPlates ? getPlateAdapter() : null;
if (withPlates && !plateAdapter) {
  console.error("No plate model configured; pass --no-plates to skip plates.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
console.log(
  `upload cases ${image ? `see ${imagePath}` : "run text-only (no --image)"}; plates ${withPlates ? `to ${outDir}` : "skipped"}`,
);

/* The eval's own look at a delivered plate. A different question from the
   product's check (what is in it, then whether that is the product), so a
   plate the check waved through on a leading question is still caught. */
const lookSchema = z.object({
  subject: z.string(),
  isProduct: z.enum(["yes", "no"]),
  writing: z.enum(["yes", "no"]),
  person: z.enum(["yes", "no"]),
});
async function lookAt(bytes: Uint8Array, product: string) {
  const { default: sharp } = await import("sharp");
  const small = await sharp(bytes)
    .resize(768, 768, { fit: "inside" })
    .jpeg({ quality: 82 })
    .toBuffer();
  const answer = await askVision({
    schema: lookSchema,
    system:
      "You describe photographs plainly and literally. Name what is actually in the picture, not what it might be meant to be.",
    text: `First, name the main subject of this photograph in a few words. Then answer: is that subject ${product}? A similar but different item is "no". Then: is there any writing anywhere, real or imitation (letters, words, numbers, a logo, squiggles shaped like text on a label or sign)? Answer "writing". Last: does any person appear at all, even in part, in profile, from behind or far off (hands alone do not count)? Answer "person".`,
    image: { bytes: new Uint8Array(small), mediaType: "image/jpeg" },
    maxOutputTokens: 200,
    timeoutMs: 30_000,
    label: "eval plate look",
  });
  return {
    subject: answer.subject,
    shows: answer.isProduct === "yes",
    writing: answer.writing === "yes",
    person: answer.person === "yes",
  };
}

async function small(bytes: Uint8Array) {
  const { default: sharp } = await import("sharp");
  return new Uint8Array(
    await sharp(bytes)
      .resize(1024, 1024, { fit: "inside" })
      .jpeg({ quality: 85 })
      .toBuffer(),
  );
}

/* The eval's own look at a finished design: a question the product never
   asks, so a layout that measured clear but drew wrong is still seen. */
const renderLookSchema = z.object({
  subject: z.string(),
  textOverSubject: z.enum(["yes", "no"]),
  subjectCut: z.enum(["yes", "no"]),
});
async function lookAtRender(png: Uint8Array) {
  const answer = await askVision({
    schema: renderLookSchema,
    system:
      "You review finished social media designs before a client sees them. Be literal and strict.",
    text: 'Name the design\'s main pictured subject (the product, or a person). Then: does any text, button, line, quote mark or logo sit on top of that subject or on a person\'s face, even partly? Answer "textOverSubject". Then: is the subject cut off by the edge of the design or of its picture frame, so that part of it is missing? Answer "subjectCut".',
    image: { bytes: await small(png), mediaType: "image/jpeg" },
    maxOutputTokens: 300,
    timeoutMs: 45_000,
    label: "eval render look",
  });
  return {
    over: answer.textOverSubject === "yes",
    cut: answer.subjectCut === "yes",
  };
}

/* The judge of the copy, by reading, against the brief: not inventedFacts,
   which filtered it, so what the detector misses is still counted. */
const judgeSchema = z.object({
  unsupported: z.array(z.string()),
  missing: z.array(z.string()),
  repeated: z.array(z.string()),
  fragments: z.array(z.string()),
});
async function judgeCopy(
  brief: string,
  profile: string,
  copy: {
    headline: string;
    subheadline?: string;
    cta?: string;
    footerLines: string[];
  },
) {
  const lines = [
    `Headline: ${copy.headline}`,
    copy.subheadline ? `Subheadline: ${copy.subheadline}` : null,
    copy.cta ? `Button: ${copy.cta}` : null,
    ...copy.footerLines.map((line) => `Footer: ${line}`),
  ].filter(Boolean);
  const answer = await askVision({
    schema: judgeSchema,
    system:
      "You check advertising copy against the client's brief before it is published. Be strict and literal: a claim is supported only if the brief or the brand profile states it.",
    text: [
      `The brief: ${brief}`,
      `The brand profile: ${profile}`,
      "The design's copy:",
      ...lines,
      'List in "unsupported" every statement in the copy that the brief and profile do not support: a number, price, day, date, time, count, duration, place or claim they never gave, or one whose meaning changed (for example "from ₦4,500" when the brief gives one price, "before 7am" for "from 7am", "only", "now", "fresh", "best"). Tone and invitations ("treat yourself") are not statements. List in "missing" every hard fact of the brief (day, date, time, price, ages, place, contact, quantity) the copy does not state, one fact per entry and nothing else: not the brand name, not the kind of event, not a comment, not a description ("hand-finished"), and nothing the brief itself does not give (a place only the profile names). Before listing a fact as missing, look for it on every line, the button included: a fact stated anywhere, in other words, in another order or abbreviated ("Sun 9 Nov", "Ages 16+", "stillwater.ng" on the button) is stated. List in "repeated" every footer item that only says again what the headline, subheadline, button or another footer item already says, in any words ("20-min call" and "20-minute call", "12–6pm" and "12pm to 6pm", a price the headline already gives). List in "fragments" every line or item that stops mid-phrase ("Zero fees for your"). Empty lists when there is nothing.',
    ].join("\n"),
    image: null,
    maxOutputTokens: 600,
    timeoutMs: 45_000,
    label: "eval copy judge",
  });
  return answer;
}

const EVAL_BRAND = "00000000-0000-4000-8000-0000000e7a11";

/* The reader alone, on every labelled brief: cheap, one small call each,
   so precision and recall are measured on more briefs than the cases can
   afford to draw. Skipped with --case. */
const readScores: (ReadScore | null)[] = [];
if (!only) {
  console.log("--- brief reader, labelled briefs ---");
  for (const readCase of READ_EVAL_CASES) {
    const raw = await readBriefWithModel({
      briefText: readCase.briefText,
      title: readCase.title,
    });
    if (!raw) {
      readScores.push(null);
      console.log(`${readCase.id}: UNAVAILABLE`);
      continue;
    }
    const settled = settleBriefRead(raw, readCase.briefText, readCase.region);
    const score = scoreBriefRead({
      read: settled.facts,
      labels: readCase.facts,
      brief: readCase.briefText,
      offering: settled.offering,
      people: settled.people,
      expected: { offering: readCase.offering, people: readCase.people },
    });
    readScores.push(score);
    console.log(
      `${readCase.id}: precise ${score.precise}/${score.extracted} recalled ${score.recalled}/${score.labelled} offering ${score.offeringRight} people ${score.peopleRight}${score.extras.length ? ` EXTRA ${JSON.stringify(score.extras)}` : ""}${score.misses.length ? ` MISSED ${JSON.stringify(score.misses)}` : ""}${settled.dropped.length ? ` dropped ${JSON.stringify(settled.dropped)}` : ""}`,
    );
    console.log(
      `   facts ${JSON.stringify(settled.facts.map((f) => `${f.kind}: ${f.text}`))} offering ${JSON.stringify(settled.offering)} people ${JSON.stringify(settled.people)}`,
    );
  }
}

const scores = [];
const outputs = [];
const rendered: RenderedCase[] = [];
for (const evalCase of cases) {
  process.stdout.write(`${evalCase.id} … `);
  const started = Date.now();
  const r = evalCase.request;
  const context = {
    source: "quick",
    brand: {
      id: EVAL_BRAND,
      name: evalCase.brand.name,
      logoUrl: evalCase.hasLogo ? "eval-logo" : null,
      primaryColor: evalCase.brand.primaryColor ?? null,
      secondaryColor: evalCase.brand.secondaryColor ?? null,
      additionalColors: evalCase.brand.additionalColors ?? null,
      brandFontUrl: null,
      bodyFontUrl: null,
    },
    brandSummary: evalCase.brand,
    briefId: null,
    calendarItemId: null,
    attachments: [],
    title: r.title,
    briefText: r.briefText,
    designType: r.designType,
    dimensions: r.dimensions,
    aspectRatio: r.aspectRatio,
    platform: r.platform,
    scheduledFor: null,
    referenceUrls: [],
    logoAssetUrls: [],
    logoCandidates: [],
  } as never;
  const category = inferCategory(r.briefText, r.designType);
  const existing = evalCase.regenerate?.existing ?? [];
  const region = brandRegion([
    ...brandFacts(evalCase.brand),
    evalCase.brand.websiteUrl,
  ]);
  /* The case's labelled facts, not the reader's: coverage is measured
     against what a person says the brief gives, so a fact the reader
     missed counts as missing from the design. */
  const labelled = settleBriefFacts(
    evalCase.facts
      .filter((f) => !f.optional)
      .map((f) => ({ kind: labelKind(f.text), text: f.text })),
    r.briefText,
    { region: phoneRegions(r.briefText, region) },
  ).facts;
  /* The people the case names are facts each direction must state, as
     they are in the job (round-5 live critic: a speaker left off). */
  const people: BriefFact[] = (evalCase.people ?? []).map((name) => ({
    kind: "person",
    text: name,
    needs: needsFor("person", name),
  }));
  const facts = [...labelled, ...people];
  const caseRecord: RenderedCase = {
    caseId: evalCase.id,
    expectRefused: Boolean(evalCase.expectRefused),
    refused: null,
    directions: [],
    factsCoveredAnywhere: 0,
    factsTotal: facts.length,
  };
  rendered.push(caseRecord);
  try {
    /* The upload exactly as production would get it: normalised as the
       browser does, then every check the loader makes. A refusal ends the
       case before any model call, as it ends the job. */
    let upload: { bytes: Uint8Array; contentType: string } | null = null;
    if (evalCase.imageSource === "upload") {
      const file = evalCase.imageFile ?? imagePath;
      if (file) {
        const normalised = await normaliseLikeBrowser(readFileSync(file));
        try {
          const loaded = await designImageFromBytes(
            normalised.bytes,
            normalised.type,
          );
          upload = {
            bytes: new Uint8Array(loaded.bytes),
            contentType: loaded.contentType,
          };
        } catch (err) {
          if (!(err instanceof DesignImageError)) throw err;
          caseRecord.refused = err.message;
          console.log(
            `${evalCase.expectRefused ? "refused as it must be" : "REFUSED unexpectedly"}: ${err.message}`,
          );
          continue;
        }
      }
      if (evalCase.expectRefused) {
        console.log("ACCEPTED a photo that must be refused");
      }
    }

    const result = await draftDirections({
      context,
      imageSource: evalCase.imageSource,
      image: upload,
      lenses:
        existing.length > 0
          ? [regenerationConcept(category)]
          : planConcepts(category),
      recentLayouts: [],
      existing,
    });
    if (!evalCase.expectRefused) {
      const score = result.read.available
        ? scoreBriefRead({
            read: result.read.facts,
            labels: evalCase.facts,
            brief: r.briefText,
            offering: result.read.offering,
            people: result.read.people,
            expected: {
              offering: evalCase.offering,
              people: evalCase.people,
            },
          })
        : null;
      readScores.push(score);
      console.log(
        `\n   read: ${score ? `precise ${score.precise}/${score.extracted} recalled ${score.recalled}/${score.labelled}${score.extras.length ? ` EXTRA ${JSON.stringify(score.extras)}` : ""}${score.misses.length ? ` MISSED ${JSON.stringify(score.misses)}` : ""}` : "UNAVAILABLE"} offering ${JSON.stringify(result.read.offering)}`,
      );
    }

    /* Imagery: the photograph once for every direction, or a checked plate
       per direction, each with what is known about its subject. */
    type Imagery = {
      asset: { bytes: Uint8Array; contentType: string };
      key: string;
      subjects: ({ x: number; y: number; w: number; h: number } | null)[];
      description?: string;
      lettering: boolean | null;
      person?: boolean | null;
      /** An object-free texture plate: no subject to cover. */
      scene?: boolean;
    } | null;
    const imagery: Imagery[] = result.directions.map(() => null);
    const plates = [];
    if (upload) {
      const measured = await measureImage(upload);
      const look = measured?.cutout ? null : await lookAtPhoto(upload.bytes);
      for (let i = 0; i < imagery.length; i += 1) {
        imagery[i] = {
          asset: upload,
          key: `design-images/${EVAL_BRAND}/${evalCase.id}.${upload.contentType === "image/png" ? "png" : "jpg"}`,
          subjects: measured?.cutout
            ? [subjectFromAlpha(measured)]
            : [look?.subject ?? null, look?.face ?? null],
          description: look?.description,
          lettering: null,
        };
      }
    } else if (plateAdapter) {
      const setting = brandSetting(result.read.facts, [
        evalCase.brand.overview,
        evalCase.brand.businessType,
      ]);
      const painted = await Promise.all(
        result.directions.map(async (direction, i) => {
          const plate = await paintCheckedPlate({
            adapter: plateAdapter,
            spec: designSpecOf(direction),
            product: direction.productName
              ? {
                  name: direction.productName,
                  look: direction.productLook,
                  kind: result.read.offering?.kind ?? "product",
                }
              : null,
            productUnchecked:
              !direction.productName &&
              Boolean(result.reports[i]?.modelProduct.name) &&
              result.productSources[i] === "none",
            setting,
            namesPeople:
              result.read.people.length > 0 || briefNamesPeople(r.briefText),
          });
          let look: {
            subject: string;
            shows: boolean | null;
            writing: boolean | null;
            person: boolean | null;
          } = {
            subject: "",
            shows: null,
            writing: null,
            person: null,
          };
          if (plate.image) {
            const ext =
              plate.image.contentType === "image/jpeg" ? "jpg" : "png";
            writeFileSync(
              join(outDir, `${evalCase.id}-${i}-plate.${ext}`),
              plate.image.bytes,
            );
            look = await lookAt(
              plate.image.bytes,
              direction.productName || evalCase.product || "the main subject",
            ).catch((err) => {
              console.log(`   plate look failed: ${(err as Error).message}`);
              return { subject: "", shows: null, writing: null, person: null };
            });
            imagery[i] = {
              asset: plate.image,
              key: `generated/${EVAL_BRAND}/plates/${evalCase.id}-${i}.${ext}`,
              subjects:
                plate.check === "scene" ? [] : [plate.look?.subject ?? null],
              description: plate.look
                ? [plate.look.seen, ...plate.look.items].join(", ")
                : undefined,
              lettering: look.writing,
              person: look.person,
              scene: plate.check === "scene",
            };
          }
          if (plate.seen.length > 0) {
            console.log(
              `\n   [${i}] plate ${plate.check}, rejected: ${JSON.stringify(plate.seen)}`,
            );
          }
          return {
            check: plate.check,
            imageCalls: plate.imageCalls,
            showsProduct: evalCase.product ? look.shows : null,
            subject: look.subject,
            rejected: plate.seen,
          };
        }),
      );
      plates.push(...painted.filter(() => Boolean(evalCase.product)));
    }

    /* Each direction laid out and drawn as the job does, in order, each
       avoiding the layouts already taken. */
    const fonts = await prepareDocumentFonts(
      { heading: null, body: null },
      result.directions
        .flatMap((d) => [d.headline, d.subheadline, d.cta, ...d.footerLines])
        .filter(Boolean)
        .join(" "),
    );
    const taken: string[] = existing.map((d) => d.layout);
    let firstPlace:
      | import("../../../jobs/directions/subject-layout").PhotoPlace
      | null = null;
    const delivered: {
      headline: string;
      subheadline?: string;
      cta?: string;
      footerLines: string[];
    }[] = [];
    const profile = [
      `Brand name: ${evalCase.brand.name}.`,
      evalCase.brand.overview,
      evalCase.brand.targetAudience,
      evalCase.brand.offer,
    ]
      .filter(Boolean)
      .join(" ");
    for (const [i, direction] of result.directions.entries()) {
      let image = imagery[i];
      let imageFacts = image ? await measureImage(image.asset) : null;
      let assets = {
        image: image ? { ref: { key: image.key }, asset: image.asset } : null,
        imageFacts,
        logo: null,
      };
      const spec = {
        ...designSpecOf(direction),
        logoPlacement: "none" as const,
      };
      const held = [
        ...taken,
        ...result.directions.slice(i + 1).map((d) => d.layout),
      ];
      const relayout = (
        s: ReturnType<typeof designSpecOf>,
        layout: typeof spec.layout,
      ) => ({
        ...respecForLayout(s, layout, {
          modelChoice: "none",
          hasLogo: false,
        }),
        logoPlacement: "none" as const,
      });
      let choice = await chooseLayout({
        spec,
        held,
        subjects: image ? image.subjects : [],
        imageless: !image,
        apartFrom:
          evalCase.imageSource === "upload" && i > 0 ? firstPlace : null,
        judge: layoutJudge(context, assets, fonts),
        relayout,
      });
      /* As the job does: a KO plate no free layout shows whole and clear is
         left off and the design laid out as text. */
      const plateFaulted =
        evalCase.imageSource === "ko" &&
        image !== null &&
        (choice.fault === SUBJECT_COVERED ||
          choice.faults.some(
            (f) => f === SUBJECT_CROPPED || f === SUBJECT_FACE_ONLY,
          ));
      if (plateFaulted) {
        image = null;
        imageFacts = null;
        assets = { image: null, imageFacts: null, logo: null };
        choice = await chooseLayout({
          spec,
          held,
          subjects: [],
          imageless: true,
          apartFrom: null,
          judge: layoutJudge(context, assets, fonts),
          relayout,
        });
        console.log(`\n   [${i}] plate left off: no layout showed it whole`);
      }
      taken.push(choice.spec.layout);
      if (i === 0) firstPlace = choice.place;
      const base = {
        caseId: evalCase.id,
        index: i,
        layout: choice.spec.layout,
        subjectKnown: Boolean(choice.subject),
        factsTotal: facts.length,
        plateLettering:
          evalCase.imageSource === "ko" ? (image?.lettering ?? null) : null,
        textLed: evalCase.imageSource === "ko" ? !image : null,
        personPainted:
          evalCase.imageSource === "ko" && people.length > 0
            ? Boolean(image?.person)
            : null,
      };
      /* As the job does: a layout that cut the subject, or kept only a
         face clear, is refused, never delivered with its fault. */
      const subjectFaulted = choice.faults.some(
        (f) => f === SUBJECT_CROPPED || f === SUBJECT_FACE_ONLY,
      );
      if (
        choice.fault === SUBJECT_COVERED ||
        choice.fault === LAYOUT_CRAFT_FAILED ||
        subjectFaulted
      ) {
        caseRecord.directions.push({
          ...base,
          subjectRefused: subjectFaulted,
          failed:
            choice.fault === SUBJECT_COVERED
              ? "copy could not be kept off the subject in any layout"
              : subjectFaulted
                ? "the subject could not be shown whole, clear of the copy"
                : "no layout drew the copy cleanly",
          overlaps: 0,
          visibleShare: null,
          edgeShare: null,
          lookTextOverSubject: null,
          lookSubjectCut: null,
          factsStated: 0,
          judgeUnsupported: [],
          judgeMissing: [],
        });
        continue;
      }
      const laidOut = { ...assets, subject: choice.subject };
      const draw = documentRenderer(context, laidOut, fonts);
      let out = await draw(choice.spec);
      let deliveredSpec = choice.spec;
      /* The gate's correction path, for real: the first render is reported
         as failing the logo check (the one correctable fault a flat eval
         render can carry), so the judge prescribes on the real pixels and
         the job's own rules decide what is kept. */
      let correction: RenderedDirection["correction"] = null;
      if (evalCase.probeCorrection) {
        const firstCopy = drawnCopyOf(out.document.elements);
        let calls = 0;
        const guarded = await guardRender(
          async (spec) => {
            calls += 1;
            const drawn = calls === 1 ? out : await draw(spec);
            return calls === 1 ? { ...drawn, logoFault: "eval probe" } : drawn;
          },
          choice.spec,
          {
            renderer: "composite",
            id: `${evalCase.id}-${i}`,
            context,
            hasLogo: false,
            rerollHelps: false,
            ...directionGateRules({
              spec: choice.spec,
              assets: laidOut,
              copyHolds: (corrected) =>
                correctionHolds(result.checks.ledger, facts, {
                  offering: result.read.offering?.phrase ?? "",
                })(choice.spec, corrected),
              keepsSubjectClear: choice.subject,
            }),
          },
        );
        out = { ...guarded, logoFault: null };
        deliveredSpec = guarded.spec;
        const lost = factsMissing(
          facts,
          drawnCopyOf(out.document.elements),
        ).filter((f) => !factsMissing(facts, firstCopy).includes(f)).length;
        correction = {
          prescribed: Boolean(guarded.correction),
          kept: Boolean(guarded.correctionKept),
          lostFacts: lost,
          overSubject:
            choice.wholeSubject && imageFacts
              ? (measureSubject(out.document, imageFacts, choice.wholeSubject)
                  ?.overlaps.length ?? 0) > 0
              : false,
        };
        console.log(
          `\n   [${i}] correction probe: ${guarded.correction ?? "no prescription"} kept=${correction.kept} lost=${lost}`,
        );
      }
      /* Corrections that change the copy, held to the job's own gate rules
         (round-4 code critic: the probe only faked a logo fault, so the
         judge never rewrote copy and the copy rules were measured on
         nothing). */
      let copyProbe: RenderedDirection["copyProbe"] = null;
      if (evalCase.probeCorrection) {
        const first = drawnCopyOf(out.document.elements);
        const rules = directionGateRules({
          spec: deliveredSpec,
          assets: laidOut,
          copyHolds: (corrected) =>
            correctionHolds(result.checks.ledger, facts, {
              offering: result.read.offering?.phrase ?? "",
            })(first, {
              headline: corrected.headline,
              subheadline: corrected.subheadline,
              cta: corrected.cta,
              footerLines: corrected.footerLines,
            }),
          keepsSubjectClear: choice.subject,
        });
        const missingFrom = (copy: typeof first) =>
          new Set(factsMissing(facts, copy).map((f) => f.text));
        const loses = (copy: typeof first) => {
          const before = missingFrom(first);
          return [...missingFrom(copy)].some((f) => !before.has(f));
        };
        const lossy = {
          ...deliveredSpec,
          footerLines: [],
          footerStyle: "none" as const,
        };
        const invented = {
          ...deliveredSpec,
          headline: "Still warm from the oven at 6am",
        };
        const rewrite = { ...deliveredSpec, headline: r.title };
        /* A headline already the title draws nothing new, and the gate
           rightly refuses a correction that would only repeat the render
           (round-6 run: bakery-ko-1 scored as a rules failure). */
        /* A rewrite that stops naming what the brief promotes is refused
           too (correctionHolds, round 6): "Ofe kimono jacket" for a copy
           that named the "Ofe linen kimono jacket". */
        const offering = result.read.offering?.phrase ?? "";
        const rewriteShouldHold =
          r.title.length <= 70 &&
          first.headline !== r.title &&
          !loses({ ...first, headline: r.title }) &&
          (!offering ||
            !copyNamesOffering(first, offering) ||
            copyNamesOffering({ ...first, headline: r.title }, offering));
        const rewriteKept = await rules.acceptCorrection(rewrite);
        let rewriteOverSubject = false;
        if (rewriteKept) {
          const second = await draw(rewrite);
          rewriteOverSubject =
            !rules.refuseSecond(second) &&
            Boolean(choice.wholeSubject && imageFacts) &&
            !choice.faults.some((f) => f.includes("person's face")) &&
            (measureSubject(
              second.document,
              imageFacts as NonNullable<typeof imageFacts>,
              choice.wholeSubject as NonNullable<typeof choice.wholeSubject>,
            )?.overlaps.length ?? 0) > 0;
        }
        copyProbe = {
          lossRefused:
            !loses({ ...first, footerLines: [] }) ||
            !(await rules.acceptCorrection(lossy)),
          inventionRefused: !(await rules.acceptCorrection(invented)),
          rewriteKept: rewriteKept === rewriteShouldHold,
          rewriteOverSubject,
        };
        console.log(
          `\n   [${i}] copy probe: loss refused ${copyProbe.lossRefused}, invention refused ${copyProbe.inventionRefused}, rewrite ${rewriteKept ? "kept" : "refused"} (should ${rewriteShouldHold ? "hold" : "be refused"}), rewrite on subject ${rewriteOverSubject}`,
        );
      }
      writeFileSync(join(outDir, `${evalCase.id}-${i}.png`), out.bytes);
      writeFileSync(
        join(outDir, `${evalCase.id}-${i}.document.json`),
        `${JSON.stringify(out.document, null, 2)}\n`,
      );
      /* What is drawn, read off the document: the builders drop a footer
         line that repeats the copy above it. */
      const copy = drawnCopyOf(out.document.elements);
      delivered.push(copy);
      const drawnAll = [
        copy.headline,
        copy.subheadline,
        copy.cta,
        ...copy.footerLines,
      ]
        .filter(Boolean)
        .join(" \n ");
      const wholeSubject =
        choice.wholeSubject && imageFacts
          ? measureSubject(out.document, imageFacts, choice.wholeSubject)
          : null;
      const craft = layoutCraftFaults(out.document);
      const reasons = settleReasons(direction.rationale, {
        factsMissing: factsMissing(facts, copy).length,
        copy,
        checks: result.checks,
        product: direction.productName,
        image: image
          ? evalCase.imageSource === "ko"
            ? "verified"
            : "seen"
          : "none",
        paintedScene:
          evalCase.imageSource === "ko"
            ? direction.backgroundPrompt
            : undefined,
        imageDescription: image?.description,
        drawn: { document: out.document, subject: wholeSubject },
      }).reasons;
      /* Oluwaseyi's ruling (round 6): a texture backdrop ("scene") has no
         subject for copy to cover, so the subject look skips it; the
         contrast and craft checks still run on it. */
      const look =
        image && !image.scene
          ? await lookAtRender(out.bytes).catch((err) => {
              console.log(`   render look failed: ${(err as Error).message}`);
              return null;
            })
          : null;
      const judged = await judgeCopy(r.briefText, profile, copy).catch(
        (err) => {
          console.log(`   judge failed: ${(err as Error).message}`);
          return { unsupported: [], missing: [], repeated: [], fragments: [] };
        },
      );
      const record: RenderedDirection = {
        ...base,
        failed: null,
        overlaps: wholeSubject?.overlaps.length ?? 0,
        visibleShare: wholeSubject?.visibleShare ?? null,
        edgeShare: wholeSubject?.edgeShare ?? null,
        lookTextOverSubject: look?.over ?? null,
        lookSubjectCut: look?.cut ?? null,
        factsStated: facts.length - factsMissing(facts, copy).length,
        judgeUnsupported: judged.unsupported,
        judgeMissing: judged.missing,
        craftHard: craft.hard,
        craftSoft: craft.soft,
        productNamed: evalCase.product
          ? [...contentStems(evalCase.product)].every((stem) =>
              contentStems(drawnAll).has(stem),
            )
          : null,
        placeholders: [
          copy.headline,
          copy.subheadline,
          copy.cta,
          ...copy.footerLines,
        ]
          .map((text) => (text ? placeholderIn(text) : null))
          .filter((p): p is string => p !== null),
        correction,
        copyProbe,
        craft5: craftOfDelivered(
          out.document.elements,
          copy,
          evalCase.product ?? result.read.offering?.phrase ?? "",
          labelled,
        ),
        peopleNamed:
          people.length > 0 ? factsMissing(people, copy).length === 0 : null,
        judgeRepeated: judged.repeated ?? [],
        judgeFragments: judged.fragments ?? [],
      };
      caseRecord.directions.push(record);
      console.log(
        `\n   [${i}] ${choice.spec.layout}${choice.spec.layout !== direction.layout ? ` (from ${direction.layout})` : ""} subject=${record.subjectKnown ? `${record.overlaps} over, visible ${record.visibleShare?.toFixed(2)}, edge ${record.edgeShare?.toFixed(2)}${isCropped(record) ? " CROPPED" : ""}` : "unknown"} look=${look ? `${look.over ? "TEXT ON SUBJECT" : "clear"}${look.cut ? ", CUT" : ""}` : "-"} facts ${record.factsStated}/${facts.length} judge ${judged.unsupported.length ? `UNSUPPORTED ${JSON.stringify(judged.unsupported)}` : "ok"}${judged.missing.length ? ` missing ${JSON.stringify(judged.missing)}` : ""}${record.plateLettering ? " PLATE LETTERED" : ""}`,
      );
      console.log(`       reasons: ${reasons.join(" | ")}`);
    }
    caseRecord.factsCoveredAnywhere = facts.filter((f) =>
      delivered.some((copy) => factsMissing([f], copy).length === 0),
    ).length;

    const score = scoreDirectionsCase(evalCase, result, plates);
    scores.push(score);
    outputs.push({ id: evalCase.id, category, result, plates });
    console.log(
      `   ${score.layouts.join(" / ")} distinct=${score.distinctness.toFixed(2)} ` +
        `model: fit ${score.modelDirectionsWithinLimits}/${score.modelDirections} grounded ${score.modelGrounded}/${score.modelReasons} ` +
        `spatial ${score.modelSpatial} invented ${score.modelInvented}/${score.modelFields} ` +
        `| delivered: grounded ${score.grounded}/${score.reasons} invented ${score.invented} false ${score.falseClaims} cut ${score.cutOff} ` +
        `| fit ${score.fitFixed}/${score.fitAsked}${score.redrafted ? " redrafted" : ""} (${Date.now() - started}ms)`,
    );
    if (score.modelInventedExamples.length > 0) {
      console.log(
        `   model invented: ${score.modelInventedExamples.join(", ")}`,
      );
    }
    for (const [i, d] of result.directions.entries()) {
      console.log(
        `   "${d.title}" — ${d.headline} | ${d.subheadline ?? ""} | [${d.cta ?? ""}] footer ${JSON.stringify(d.footerLines)} product="${d.productName}" (${result.productSources[i]})`,
      );
      for (const dropped of result.reports[i]?.reasonsDropped ?? []) {
        console.log(`      x ${dropped.reason}  (${dropped.why})`);
      }
      for (const fallback of result.reports[i]?.copyFallbacks ?? []) {
        console.log(
          `      ~ ${fallback.field}: "${fallback.from}" -> ${fallback.to === null ? "left off" : `"${fallback.to}"`}`,
        );
      }
      const plate = plates[i];
      if (plate) {
        console.log(
          `      plate: ${plate.check} (${plate.imageCalls} call${plate.imageCalls === 1 ? "" : "s"}), eval sees "${plate.subject}" -> ${plate.showsProduct}`,
        );
      }
    }
    if (result.footerRepeats.outcomes.length > 0) {
      console.log(
        `   footer repeats marked ${JSON.stringify(result.footerRepeats.outcomes)}`,
      );
    }
    if (
      result.factCoverage.added.length > 0 ||
      result.factCoverage.leftOff.length > 0
    ) {
      console.log(
        `   facts added ${JSON.stringify(result.factCoverage.added)} left off ${JSON.stringify(result.factCoverage.leftOff)}`,
      );
    }
  } catch (error) {
    /* The cause is what says which field broke the schema; the message
       alone ("did not match schema") cannot be acted on. */
    const cause = (error as { cause?: unknown }).cause;
    console.log(`ERROR ${(error as Error).message}`);
    if (cause) {
      const text = String(cause);
      const issues = text.indexOf("Error message:");
      console.log(
        `   cause: ${issues >= 0 ? text.slice(issues, issues + 1500) : text.slice(-1500)}`,
      );
    }
    process.exitCode = 1;
  }
}

const totals = aggregateDirections(scores);
const t = DIRECTIONS_EVAL_THRESHOLDS;
const scoredCases = cases.filter((c) => !c.expectRefused).length;
const renderTotals = aggregateRender(rendered);
const readTotals = aggregateReads(readScores);
const failures = [
  ...(scores.length > 0 ? directionsFailures(totals, t, scoredCases) : []),
  ...(rendered.length > 0 ? renderFailures(renderTotals) : []),
  ...(readScores.length > 0 ? readFailures(readTotals) : []),
];
const f2 = (n: number) => n.toFixed(2);

console.log("\n--- brief reader ---");
console.log(
  `briefs ${readTotals.briefs} (unavailable ${readTotals.unavailable}); precision ${f2(readTotals.precision)} (min ${READ_THRESHOLDS.minPrecision}); recall ${f2(readTotals.recall)} (min ${READ_THRESHOLDS.minRecall}); offering ${f2(readTotals.offeringAccuracy)} (min ${READ_THRESHOLDS.minOfferingAccuracy}); people ${f2(readTotals.peopleAccuracy)} (min ${READ_THRESHOLDS.minPeopleAccuracy})`,
);
console.log("\n--- model's own answer ---");
console.log(
  `writes to length ${f2(totals.modelWithinLimits)} (min ${t.minModelWithinLimits})`,
);
console.log(
  `grounded reasons ${f2(totals.modelGroundedShare)} (min ${t.minModelGroundedShare})`,
);
console.log(
  `spatial reasons ${f2(totals.modelSpatialShare)} (max ${t.maxModelSpatialShare})`,
);
console.log(
  `invented facts ${f2(totals.modelInventedShare)} of fields (max ${t.maxModelInventedShare})`,
);
console.log(
  `cut-off reasons ${f2(totals.modelCutOffShare)} (max ${t.maxModelCutOffShare})`,
);
console.log(`layouts differ ${f2(totals.modelLayoutsDiffer)}`);
console.log("\n--- delivered ---");
console.log(
  `cases scored ${totals.cases}/${cases.length}; direction count right ${f2(totals.countRight)}`,
);
console.log(
  `layouts differ ${f2(totals.layoutsDiffer)}; within limits ${f2(totals.withinLimits)}`,
);
console.log(
  `grounded ${f2(totals.groundedShare)} (min ${t.minGroundedShare}); filler ${f2(totals.fillerShare)} (max ${t.maxFillerShare})`,
);
console.log(
  `jargon ${totals.jargon}, spatial ${totals.spatial}, cut off ${totals.cutOff}, false claims ${totals.falseClaims}, invented ${totals.invented} (each max 0)`,
);
console.log(
  `distinctness mean ${f2(totals.meanDistinctness)} (min ${t.minMeanDistinctness}), worst ${f2(totals.minDistinctness)}`,
);
console.log(
  `near-duplicates: first call ${totals.firstNearDuplicates}, delivered ${totals.finalNearDuplicates}; redrafts ${totals.redrafts}`,
);
console.log(
  `fit pass: ${totals.fitFixed}/${totals.fitAsked} fields fixed; model calls ${totals.modelCalls}`,
);
console.log(
  `product named ${f2(totals.productNamed)} (min ${t.minProductNamed})`,
);
console.log(
  `plates ${totals.plates}: show the product ${f2(totals.plateShowsProduct)} (min ${t.minPlateShowsProduct}), wrong product delivered ${totals.wrongProductPlates} (max ${t.maxWrongProductPlates}), retried ${totals.platesRetried}, drawn flat ${totals.platesFlat}, plate calls ${totals.plateImageCalls}`,
);
const rt = RENDER_THRESHOLDS;
console.log("\n--- rendered ---");
console.log(
  `directions ${renderTotals.directions} (failed ${renderTotals.failedDirections}); subject known ${f2(renderTotals.subjectKnownShare)}`,
);
console.log(
  `copy over subject ${renderTotals.copyOverSubject} (max ${rt.maxCopyOverSubject}); look: text over subject ${f2(renderTotals.lookTextOverSubjectShare)} (max ${rt.maxLookTextOverSubjectShare})`,
);
console.log(
  `cropped ${f2(renderTotals.croppedShare)} (max ${rt.maxCroppedShare}); look: cut ${f2(renderTotals.lookCutShare)}`,
);
console.log(
  `brief facts on any direction ${f2(renderTotals.caseFactCoverage)} (min ${rt.minCaseFactCoverage}); per direction ${f2(renderTotals.directionFactCoverage)} (min ${rt.minDirectionFactCoverage}); judge missing ${f2(renderTotals.judgeMissingShare)}`,
);
console.log(
  `judge: invented ${f2(renderTotals.judgeInventedShare)} (max ${rt.maxJudgeInventedShare}); missing ${f2(renderTotals.judgeMissingShare)} (max ${rt.maxJudgeMissingShare})`,
);
console.log(
  `craft faults delivered ${renderTotals.craftHard} (max ${rt.maxCraftHard}); soft ${f2(renderTotals.craftSoftShare)}; rendered copy names the product ${f2(renderTotals.productNamedShare)} (min ${rt.minProductNamedShare}); placeholders ${renderTotals.placeholders} (max ${rt.maxPlaceholders})`,
);
console.log(
  `correction path: probed ${renderTotals.correctionsProbed} (min ${rt.minCorrectionsProbed}), prescribed ${renderTotals.correctionsPrescribed}, kept ${renderTotals.correctionsKept}, lost facts ${renderTotals.correctionLostFacts} (max ${rt.maxCorrectionLostFacts}), copy on subject ${renderTotals.correctionOverSubject} (max ${rt.maxCorrectionOverSubject})`,
);
console.log(
  `plates ${renderTotals.plates}: lettered ${f2(renderTotals.letteredPlateShare)} (max ${rt.maxLetteredPlateShare}); KO directions laid out as text (no plate passed) ${renderTotals.textLed}/${renderTotals.koDirections}`,
);
console.log(
  `round-5 craft: empty image regions ${renderTotals.emptyImageRegions} (max ${rt.maxEmptyImageRegions}); footer repeats ${renderTotals.footerRepeats} (max ${rt.maxFooterRepeats}); product name in footer ${renderTotals.productInFooter} (max ${rt.maxProductInFooter}); picture over its frame ${renderTotals.imageOverFrame} (max ${rt.maxImageOverFrame})`,
);
console.log(
  `round-6: delivered subject cut ${renderTotals.deliveredSubjectCut} (max ${rt.maxDeliveredSubjectCut}), refused for the subject ${renderTotals.subjectRefused}; KO laid out as text ${f2(renderTotals.textLedShare)} (max ${rt.maxTextLedShare}); named people on every direction ${f2(renderTotals.peopleNamedShare)} (min ${rt.minPeopleNamedShare}); person painted beside a named one ${renderTotals.personPainted} (max ${rt.maxPersonPainted}); judge footer repeats ${f2(renderTotals.judgeRepeatedShare)} (max ${rt.maxJudgeRepeatedShare}); fragments ${renderTotals.fragments} (max ${rt.maxFragments}); prices without unit ${renderTotals.pricesDetached} (max ${rt.maxPricesDetached}); picture against its card's edge ${renderTotals.imageAgainstFrame} (max ${rt.maxImageAgainstFrame})`,
);
console.log(
  `copy corrections: probed ${renderTotals.copyProbes} (min ${rt.minCopyProbes}), rules wrong ${renderTotals.copyProbeFailures} (max ${rt.maxCopyProbeFailures}), copy on the whole subject ${renderTotals.copyProbeOverSubject} (max ${rt.maxCopyProbeOverSubject})`,
);
console.log(
  `bad photos refused ${renderTotals.refusalsMade}/${renderTotals.refusalsExpected}; unexpected refusals ${renderTotals.unexpectedRefusals}`,
);
console.log(
  failures.length === 0
    ? `PASS across ${scores.length} cases`
    : `FAIL across ${scores.length} cases: ${failures.join("; ")}`,
);

mkdirSync("qa-reports/eval", { recursive: true });
const reportPath = "qa-reports/eval/design-directions.json";
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      totals,
      renderTotals,
      readTotals,
      readScores,
      thresholds: t,
      renderThresholds: RENDER_THRESHOLDS,
      failures,
      scores,
      rendered,
      outputs,
    },
    null,
    2,
  )}\n`,
);
console.log(`report: ${reportPath}`);

if (failures.length > 0) process.exitCode = 1;
