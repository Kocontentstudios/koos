CREATE TABLE IF NOT EXISTS "brand_memory" (
	"brand_id" uuid PRIMARY KEY NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"facts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "brand_memory" ADD CONSTRAINT "brand_memory_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
