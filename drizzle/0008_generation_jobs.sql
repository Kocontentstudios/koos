CREATE TYPE "public"."generation_job_kind" AS ENUM('strategy', 'calendar');
--> statement-breakpoint
CREATE TYPE "public"."generation_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed');
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "generation_job_kind" NOT NULL,
	"user_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	"status" "generation_job_status" DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"result_id" uuid,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "generation_jobs_user_id_idx" ON "generation_jobs" ("user_id");
