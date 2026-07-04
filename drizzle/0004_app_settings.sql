CREATE TABLE "app_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"design_team_email" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
