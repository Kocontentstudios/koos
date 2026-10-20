-- Interim paywall until the payment provider is integrated: a new workspace is
-- unusable until an admin approves it after the client's onboarding call and
-- payment. The gate itself lives in src/lib/auth/workspace-approval.ts.
--
-- The column is added with DEFAULT 'approved' so every workspace that exists
-- at deploy time is grandfathered in the same statement that creates it, then
-- the default flips to 'pending' so only signups after this deploy are gated.
-- Both statements run in the runner's single transaction, so no row can be
-- created between them with the wrong default.
--
-- The running bundle never names these columns, so this is safe in a single
-- deploy.
CREATE TYPE "public"."workspace_access_status" AS ENUM('pending', 'approved');
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "access_status" "workspace_access_status" NOT NULL DEFAULT 'approved';
--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "access_status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "access_decided_at" timestamp;
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN IF NOT EXISTS "access_decided_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
-- The admin Access page lists pending workspaces first.
CREATE INDEX IF NOT EXISTS "workspaces_access_status_idx" ON "workspaces" ("access_status");
