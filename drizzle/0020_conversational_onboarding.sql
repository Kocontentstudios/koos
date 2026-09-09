CREATE TYPE "onboarding_type_v2" AS ENUM ('manual', 'document', 'conversational');
--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "onboarding_type" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "onboarding_type" TYPE "onboarding_type_v2"
	USING "onboarding_type"::text::"onboarding_type_v2";
--> statement-breakpoint
ALTER TABLE "brands" ALTER COLUMN "onboarding_type" SET DEFAULT 'manual';
--> statement-breakpoint
DROP TYPE "onboarding_type";
--> statement-breakpoint
ALTER TYPE "onboarding_type_v2" RENAME TO "onboarding_type";
