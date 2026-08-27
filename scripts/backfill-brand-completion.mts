/**
 * Recomputes brands.completion_percentage with the weighted five-section
 * formula (KOS-V1-BUG-001).
 *
 * Every row written before that change carries a wrong number: the manual form
 * hardcoded 100, and the conversational path scored only the four Basics
 * fields. Display surfaces now compute from the row, so this is data hygiene
 * rather than a correctness fix — nothing user-facing depends on it.
 *
 * Imports the same function the app uses; there is deliberately no second copy
 * of the formula in SQL to drift out of step.
 *
 *   Dry run (default):  pnpm exec tsx scripts/backfill-brand-completion.mts
 *   Apply:              pnpm exec tsx scripts/backfill-brand-completion.mts --apply
 */
import { mkdirSync, writeFileSync } from "node:fs";
import postgres from "postgres";
import { brandProfileCompletion } from "../src/lib/brand-profile.js";

const APPLY = process.argv.includes("--apply");
const OUT_DIR = "/tmp/brand-completion";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("No DIRECT_URL/DATABASE_URL set — nothing to do.");
  process.exit(0);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

try {
  const rows = await sql`
    select id, name, onboarding_status, completion_percentage,
           overview, business_type, stage,
           target_audience, offer, tone, primary_goal,
           values, words_love, words_avoid,
           brand_style, primary_color, secondary_color, additional_colors,
           logo_url, platforms, primary_platform, posting_frequency
    from brands
    order by created_at
  `;

  const changes = rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      status: row.onboarding_status,
      before: row.completion_percentage,
      after: brandProfileCompletion({
        name: row.name,
        overview: row.overview,
        businessType: row.business_type,
        stage: row.stage,
        targetAudience: row.target_audience,
        offer: row.offer,
        tone: row.tone,
        primaryGoal: row.primary_goal,
        values: row.values,
        wordsLove: row.words_love,
        wordsAvoid: row.words_avoid,
        brandStyle: row.brand_style,
        primaryColor: row.primary_color,
        secondaryColor: row.secondary_color,
        additionalColors: row.additional_colors,
        logoUrl: row.logo_url,
        platforms: row.platforms,
        primaryPlatform: row.primary_platform,
        postingFrequency: row.posting_frequency,
      }),
    }))
    .filter((c) => c.before !== c.after);

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  // The snapshot is what makes this reversible; write it before touching a row.
  writeFileSync(
    `${OUT_DIR}/snapshot-${stamp}.json`,
    JSON.stringify(rows, null, 2),
  );
  const csvPath = `${OUT_DIR}/before-after-${stamp}.csv`;
  writeFileSync(
    csvPath,
    ["id,name,onboarding_status,before,after"]
      .concat(
        changes.map((c) =>
          [c.id, c.name, c.status, c.before, c.after].map(csvCell).join(","),
        ),
      )
      .join("\n"),
  );

  console.log(`Brands scanned:   ${rows.length}`);
  console.log(`Rows to correct:  ${changes.length}`);
  console.log(`Snapshot:         ${OUT_DIR}/snapshot-${stamp}.json`);
  console.log(`Before/after CSV: ${csvPath}`);

  for (const c of changes.slice(0, 20)) {
    console.log(`  ${c.name}: ${c.before}% -> ${c.after}% (${c.status})`);
  }
  if (changes.length > 20) {
    console.log(`  … ${changes.length - 20} more, see the CSV`);
  }

  if (!APPLY) {
    console.log("\nDry run. Re-run with --apply to write these values.");
  } else {
    for (const c of changes) {
      await sql`
        update brands set completion_percentage = ${c.after} where id = ${c.id}
      `;
    }
    console.log(`\nApplied ${changes.length} updates.`);
  }
} finally {
  await sql.end();
}
