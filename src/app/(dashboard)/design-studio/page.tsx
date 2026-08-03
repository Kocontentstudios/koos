import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/auth/workspace";
import {
  getActiveBrandForMember,
  listDesignGenerationsForBrand,
} from "@/lib/db/queries";
import { serializeGeneration } from "@/lib/design/serialize";
import { DesignStudioClient } from "./design-studio-client";

/** Guarded by workspace membership only, not requireBrand: the studio should
 * be reachable from the sidebar even before a brand profile is complete. */
export default async function DesignStudioPage() {
  const { dbUser, workspace } = await getActiveWorkspace();
  if (!dbUser || !workspace) redirect("/login");

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
    />
  );
}
