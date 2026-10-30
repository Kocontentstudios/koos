import { KoImageryProvider } from "@/components/design/directions/ko-imagery-context";
import { redirectToLogin } from "@/lib/auth/redirects";
import { requireOpenWorkspace } from "@/lib/auth/require-open-workspace";
import {
  getActiveBrandForMember,
  listDesignGenerationsForBrand,
  listSetFrames,
} from "@/lib/db/queries";
import { koImageryEnabled } from "@/lib/design/ko-imagery-flag";
import { serializeGeneration } from "@/lib/design/serialize";
import { DesignStudioClient } from "./design-studio-client";
import { historyRows } from "./history-rows";

/** Guarded by workspace membership only, not requireBrand: the studio should
 * be reachable from the sidebar even before a brand profile is complete. */
export default async function DesignStudioPage() {
  const { dbUser, workspace } = await requireOpenWorkspace();
  if (!dbUser || !workspace) redirectToLogin();

  const brand = await getActiveBrandForMember(workspace.id, dbUser.id);
  const rows = brand
    ? await historyRows(
        await listDesignGenerationsForBrand(brand.id, { limit: 24 }),
        (setId) => listSetFrames(brand.id, setId),
      )
    : [];
  const generations = await Promise.all(rows.map(serializeGeneration));

  return (
    <KoImageryProvider enabled={koImageryEnabled()}>
      <DesignStudioClient
        brandId={brand?.id ?? null}
        brandName={brand?.name ?? null}
        /* A set's failed frames stay: the viewer offers to retry them. */
        initialGenerations={generations.filter(
          (g) => g.frame !== null || g.status === "succeeded",
        )}
      />
    </KoImageryProvider>
  );
}
