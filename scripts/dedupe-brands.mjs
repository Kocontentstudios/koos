/**
 * READ-ONLY report of duplicate brands per user, with child-row counts on each
 * brand. Duplicates were created by the pre-fix "Edit Brand" flow inserting a new
 * row instead of updating. This script does NOT modify anything — its output is
 * the input to the reviewed cleanup migration.
 *
 * Run: node scripts/dedupe-brands.mjs
 */
import postgres from "postgres";

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env
}

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("No DIRECT_URL/DATABASE_URL set — nothing to report.");
  process.exit(0);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

const CHILD_TABLES = [
  "brand_contexts",
  "brand_assets",
  "chat_conversations",
  "strategies",
  "calendars",
  "design_tickets",
  "usage_events",
];

try {
  const dupUsers = await sql`
    select user_id, count(*) as brand_count
    from brands
    group by user_id
    having count(*) > 1
    order by count(*) desc`;

  if (dupUsers.length === 0) {
    console.log("✓ No users have duplicate brands.");
    process.exit(0);
  }

  console.log(`Found ${dupUsers.length} user(s) with duplicate brands:\n`);

  for (const { user_id } of dupUsers) {
    const rows = await sql`
      select id, name, onboarding_status, created_at, updated_at
      from brands
      where user_id = ${user_id}
      order by updated_at desc`;

    console.log(`User ${user_id} — ${rows.length} brands:`);
    for (const b of rows) {
      const counts = [];
      for (const t of CHILD_TABLES) {
        const [{ n }] = await sql`
          select count(*)::int as n
          from ${sql(t)}
          where brand_id = ${b.id}`;
        if (n > 0) counts.push(`${t}=${n}`);
      }
      const children = counts.length ? counts.join(", ") : "no children";
      console.log(
        `  • ${b.id}  updated=${b.updated_at.toISOString()}  status=${b.onboarding_status}  (${children})`,
      );
    }
    console.log("");
  }

  console.log(
    "Review the above. The cleanup migration must reassign children to the\n" +
      "surviving row (the one to keep) BEFORE deleting the others, to avoid\n" +
      "cascade-deleting strategies/calendars/tickets.",
  );
} catch (e) {
  console.error(`Report failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 }).catch(() => {});
}
