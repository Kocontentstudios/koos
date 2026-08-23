CREATE TYPE "workspace_role_v2" AS ENUM ('owner', 'admin', 'brand_manager', 'contributor');
--> statement-breakpoint
CREATE TYPE "brand_scope" AS ENUM ('all', 'assigned');
--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" TYPE "workspace_role_v2"
	USING (CASE "role"::text WHEN 'member' THEN 'contributor' ELSE "role"::text END)::"workspace_role_v2";
--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'contributor';
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" TYPE "workspace_role_v2"
	USING (CASE "role"::text WHEN 'member' THEN 'contributor' ELSE "role"::text END)::"workspace_role_v2";
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "role" SET DEFAULT 'contributor';
--> statement-breakpoint
DROP TYPE "workspace_role";
--> statement-breakpoint
ALTER TYPE "workspace_role_v2" RENAME TO "workspace_role";
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "brand_scope" "brand_scope" DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_privileged_scope_check"
	CHECK ("role" NOT IN ('owner', 'admin') OR "brand_scope" = 'all');
--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_brand_manager_scope_check"
	CHECK ("role" <> 'brand_manager' OR "brand_scope" = 'assigned');
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN "brand_scope" "brand_scope" DEFAULT 'all' NOT NULL;
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_privileged_scope_check"
	CHECK ("role" NOT IN ('owner', 'admin') OR "brand_scope" = 'all');
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_brand_manager_scope_check"
	CHECK ("role" <> 'brand_manager' OR "brand_scope" = 'assigned');
--> statement-breakpoint
CREATE TABLE "workspace_invitation_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invitation_id" uuid NOT NULL,
	"brand_id" uuid NOT NULL,
	CONSTRAINT "workspace_invitation_brands_invitation_id_brand_id_unique" UNIQUE("invitation_id","brand_id")
);
--> statement-breakpoint
ALTER TABLE "workspace_invitation_brands" ADD CONSTRAINT "wib_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."workspace_invitations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_invitation_brands" ADD CONSTRAINT "wib_brand_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "member_brand_access" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "member_brand_access" ADD CONSTRAINT "mba_membership_fk"
	FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;
