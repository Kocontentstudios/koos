import { redirectToLogin } from "@/lib/auth/redirects";
import { requireOpenWorkspace } from "@/lib/auth/require-open-workspace";
import {
  getActiveBrandForMember,
  listDesignGenerationsForBrand,
} from "@/lib/db/queries";
import { koImageryEnabled } from "@/lib/design/ko-imagery-flag";
import { serializeGeneration } from "@/lib/design/serialize";
import { DesignStudioClient } from "./design-studio-client";

/** Guarded by workspace membership only, not requireBrand: the studio should
 * be reachable from the sidebar even before a brand profile is complete. */
export default async function DesignStudioPage() {
  const { dbUser, workspace } = await requireOpenWorkspace();
  if (!dbUser || !workspace) redirectToLogin();

  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);
  const rows = brand
    ? await listDesignGenerationsForBrand(brand.id, { limit: 24 })
    : [];
  const generations = await Promise.all(rows.map(serializeGeneration));

  return (
    <DesignStudioClient
      brandId={brand?.id ?? null}
      brandName={brand?.name ?? null}
      initialGenerations={generations.filter((g) => g.status === "succeeded")}
      koImagery={koImageryEnabled()}
    />
  );
}
