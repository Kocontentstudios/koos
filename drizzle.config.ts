import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations need a session/direct connection (DDL + prepared statements).
    // The transaction pooler (port 6543) used at runtime can't run them, so
    // prefer DIRECT_URL and fall back to DATABASE_URL for local dev.
    url: (process.env.DIRECT_URL ?? process.env.DATABASE_URL) as string,
  },
});
