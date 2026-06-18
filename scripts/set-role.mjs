/**
 * Set a user's role directly in the database — used to bootstrap the first
 * admin (after which roles are managed in-app at /admin/users).
 *
 *   node scripts/set-role.mjs <email> <user|designer|admin>
 */
import postgres from "postgres";

const ROLES = ["user", "designer", "admin"];
const [, , email, role] = process.argv;

if (!email || !ROLES.includes(role)) {
  console.error(
    "Usage: node scripts/set-role.mjs <email> <user|designer|admin>",
  );
  process.exit(1);
}

try {
  process.loadEnvFile(".env");
} catch {
  // rely on ambient env
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, connect_timeout: 15 });
try {
  const rows = await sql`
    update users set role = ${role}, updated_at = now()
    where email = ${email}
    returning id, email, role`;
  if (rows.length === 0) {
    console.error(`No user found with email "${email}".`);
    process.exit(1);
  }
  console.log(`✓ ${rows[0].email} is now "${rows[0].role}".`);
} catch (e) {
  console.error("Failed:", e.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 3 }).catch(() => {});
}
