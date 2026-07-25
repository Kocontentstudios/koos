import { requireRole } from "@/lib/auth/require-role";
import { listBrandsForAdmin } from "@/lib/db/queries";
import { BrandsTable } from "./brands-table";

export default async function AdminBrandsPage() {
  await requireRole(["admin"]);
  const rows = await listBrandsForAdmin();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-foreground">
          Brands
        </h1>
        <p className="mt-1 text-[14px] text-[var(--text-secondary)]">
          Every brand on the platform. Open one to read its full profile and
          download its assets.
        </p>
      </div>
      <BrandsTable
        brands={rows.map((r) => ({
          id: r.brand.id,
          name: r.brand.name,
          ownerEmail: r.ownerEmail,
          workspaceName: r.workspaceName,
          status: r.brand.onboardingStatus,
          completionPercentage: r.brand.completionPercentage,
          ticketCount: r.ticketCount,
          createdAt: r.brand.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
